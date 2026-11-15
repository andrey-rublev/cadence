"""Keystroke timing on the Aalto 136M Keystrokes dataset, and the keyboard model the passive
product uses.

    uv run python scripts/aalto.py --zip ../data/external/aalto/Keystrokes.zip --people 2000

Dataset: Dhakal, Feit, Kristensson, Oulasvirta. Observations on Typing from 136 Million
Keystrokes. CHI 2018. https://userinterfaces.aalto.fi/136Mkeystrokes/ . Free for
non-commercial use with attribution; never committed (data/external/ is gitignored).

Each participant copied 15 sentences in one sitting, so there is no second session: the
first half of their sentences is the enrollment, the second half the probes. That is the
same-sitting case, which our own volunteers showed overstates accuracy (PLAN.md).

Only QWERTY desktop and laptop keyboards are used, because zones assume QWERTY. Keys are
reduced to zones exactly as the browser SDK does; characters are discarded on load.

1. Learning curve: 5 participant-grouped folds, training on k people.
2. Keys per check.
3. Saves the keyboard model (artifacts/models/keys/) with thresholds chosen on held-out typists.
"""

import argparse
import hashlib
import io
import json
import random
import time
import zipfile
from pathlib import Path

import numpy as np

from cadence.core.config import REPO_ROOT, settings
from cadence.features.keys import (
    HIDDEN,
    KEY_FEATURE_NAMES,
    KEY_SCHEMA,
    MODIFIER,
    window_vector,
    windows,
    zone_of_keycode,
)
from cadence.verifier.artifact import Model, save
from cadence.verifier.baseline import Baseline
from cadence.verifier.data import Round, sessions_by_person
from cadence.verifier.evaluation import Attempt, evaluate, select
from cadence.verifier.metrics import choose_thresholds
from cadence.verifier.pairwise import fit_pairwise

FOLDS = 5
REPS = 300
WINDOW = 50
FITS = {
    "b0": lambda rs: Baseline.fit(np.array([r.vector for r in rs])),
    "m2": lambda rs: fit_pairwise(rs, "boosting", negatives_per_template=100),
}
NAMES = {"b0": "B0 keystroke distance", "m2": "M2 pairwise boosting"}
PROBE_KEYS: dict[tuple[str, int], int] = {}  # (participant, round) -> keys in a login-length probe


def load_aalto(path: Path, people: int) -> dict[str, dict[str, list]]:
    """participant -> {"enroll": presses, "probe": presses}. Presses are (down, up, zone); no characters kept."""
    with zipfile.ZipFile(path) as archive:
        meta_name = next(n for n in archive.namelist() if n.endswith("metadata_participants.txt"))
        lines = io.TextIOWrapper(archive.open(meta_name), encoding="utf-8", errors="replace").read().splitlines()
        header = lines[0].split("\t")
        col = {name: header.index(name) for name in ("PARTICIPANT_ID", "LAYOUT", "KEYBOARD_TYPE")}
        eligible = []
        for line in lines[1:]:
            row = line.split("\t")
            if len(row) == len(header) and row[col["LAYOUT"]].lower() == "qwerty" and row[col["KEYBOARD_TYPE"]] in ("full", "laptop"):
                eligible.append(row[col["PARTICIPANT_ID"]])
        # A fixed, content-independent sample of participants.
        eligible.sort(key=lambda pid: hashlib.sha256(f"aalto:{pid}".encode()).hexdigest())
        names = set(archive.namelist())
        data: dict[str, dict[str, list]] = {}
        for pid in eligible:
            if len(data) >= people:
                break
            name = f"Keystrokes/files/{pid}_keystrokes.txt"
            if name not in names:
                continue
            by_sentence: dict[str, list] = {}
            text = archive.read(name).decode("utf-8", errors="replace").splitlines()
            for line in text[1:]:
                row = line.split("\t")
                if len(row) != 9:
                    continue
                try:
                    down, up, keycode = float(row[5]), float(row[6]), int(row[8])
                except ValueError:
                    continue
                by_sentence.setdefault(row[1], []).append((down, up, zone_of_keycode(keycode)))
            sentences = [sorted(p) for p in by_sentence.values() if p]
            sentences.sort(key=lambda p: p[0][0])
            if len(sentences) < 10:
                continue
            half = len(sentences) // 2
            enroll = [p for s in sentences[:half] for p in s]
            probe = [p for s in sentences[half:] for p in s]
            data[pid] = {"enroll": enroll, "probe": probe}
    return data


def to_rounds(data: dict[str, dict[str, list]], size: int) -> list[Round]:
    rounds = []
    for pid, d in data.items():
        for offset, key in ((0, "enroll"), (1_000_000, "probe")):
            for i, w in enumerate(windows(d[key], size)):
                rounds.append(Round(pid, "", f"{pid}:{key}", offset + i, window_vector(w), pid))
    people = sessions_by_person(rounds)
    return [r for r in rounds if len(people[r.participant]) == 2]


def to_short_rounds(
    data: dict[str, dict[str, list]], low: int, high: int, hidden_share: float, seed: int = 0
) -> list[Round]:
    """Login-length probes: enrollment stays in 50-key windows; the probe half is cut into
    windows of `low`-`high` keys, the last `hidden_share` of each with its zones hidden, as a
    password field sends them (timing only)."""
    rng = random.Random(seed)
    rounds = []
    for pid, d in data.items():
        for i, w in enumerate(windows(d["enroll"], WINDOW)):
            rounds.append(Round(pid, "", f"{pid}:enroll", i, window_vector(w), pid))
        presses, i = d["probe"], 0
        while True:
            size = rng.randint(low, high)
            typing = [p for p in presses if p[2] != MODIFIER]
            if len(typing) < size:
                break
            cut = presses.index(typing[size - 1]) + 1
            window, presses = presses[:cut], presses[cut:]
            secret_from = int(len(window) * (1 - hidden_share))
            window = window[:secret_from] + [(d0, u0, HIDDEN) for d0, u0, _ in window[secret_from:]]
            rounds.append(Round(pid, "", f"{pid}:probe", 1_000_000 + i, window_vector(window), pid))
            PROBE_KEYS[(pid, 1_000_000 + i)] = size
            i += 1
    people = sessions_by_person(rounds)
    return [r for r in rounds if len(people[r.participant]) == 2]


def folded(rounds: list[Round], model: str, train_size: int | None = None, seed: int = 0) -> list[Attempt]:
    people = sessions_by_person(rounds)
    order = sorted(people, key=lambda n: hashlib.sha256(f"fold:{n}".encode()).hexdigest())
    rng = random.Random(seed)
    attempts = []
    for k in range(FOLDS):
        fold = order[k::FOLDS]
        rest = [p for p in order if p not in set(fold)]
        train = set(rest if train_size is None else rng.sample(rest, min(train_size, len(rest))))
        verifier = FITS[model]([r for r in rounds if r.participant in train])
        for target in fold:
            enrollment = np.array([r.vector for r in people[target][0]])
            # Impostors: a sample of 20 fold-mates keeps the attempt count manageable.
            others = [p for p in fold if p != target]
            claimants = [target] + rng.sample(others, min(20, len(others)))
            for claimant in claimants:
                probes = people[claimant][1]
                scores = verifier.score_many(enrollment, np.array([r.vector for r in probes]))
                attempts += [
                    Attempt(target, claimant, float(s), r.session, r.at, True) for r, s in zip(probes, scores) if np.isfinite(s)
                ]
    return attempts


def result(model: str, attempts: list[Attempt]) -> dict:
    entry = evaluate({model: attempts}, reps=REPS)[model]
    return {
        "model": model,
        "auc": entry["one_round"]["auc"],
        "eer": entry["one_round"]["eer"],
        "auc_3": entry["three_rounds"]["auc"],
        "eer_3": entry["three_rounds"]["eer"],
        "policy": entry["policy"],
        "genuine_attempts": entry["counts"]["genuine_attempts"],
        "impostor_attempts": entry["counts"]["impostor_attempts"],
    }


def fmt(r: dict) -> str:
    a = r["auc"]
    return (
        f"AUC {a['value']:.3f} ({a['low']:.3f}-{a['high']:.3f})  EER {r['eer']['value']:.1%}"
        f"  | 3 windows: AUC {r['auc_3']['value']:.3f} EER {r['eer_3']['value']:.1%}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--people", type=int, default=2000)
    parser.add_argument("--no-model", action="store_true", help="run the experiments only")
    parser.add_argument(
        "--login", action="store_true", help="train the login-length model (probes of 15-45 keys, password part hidden)"
    )
    args = parser.parse_args()

    started = time.time()
    data = load_aalto(args.zip, args.people)
    if args.login:
        login_model(data)
        return
    rounds = to_rounds(data, WINDOW)
    n = len({r.participant for r in rounds})
    print(f"{n} typists, {len(rounds)} windows of {WINDOW} keys (loaded in {time.time() - started:.0f} s)\n")
    report: dict = {
        "dataset": "Aalto 136M Keystrokes (Dhakal et al., CHI 2018), QWERTY desktop and laptop keyboards",
        "people": n,
        "window_keys": WINDOW,
        "features": list(KEY_FEATURE_NAMES),
        "caveats": [
            "Enrollment and probes come from the same sitting (first and second half of 15 copied sentences); real use spans days and is less accurate.",
            "Copy-typing of shown sentences, not free composition inside an app.",
            "Each typist used their own keyboard, so device differences help separate people.",
        ],
    }

    print("1. Training people (5 folds; scored typists never in training)")
    report["learning_curve"] = []
    for k in (10, 50, 200, None):
        for model in FITS:
            r = result(model, folded(rounds, model, k)) | {"training_people": k or n * (FOLDS - 1) // FOLDS}
            report["learning_curve"].append(r)
            print(f"   {r['training_people']:>5} people  {NAMES[model]:<24} {fmt(r)}")

    print("\n2. Keys per check (all other folds for training)")
    report["keys_per_check"] = []
    for size in (25, 50, 100):
        sized = to_rounds(data, size)
        for model in FITS:
            r = result(model, folded(sized, model)) | {"keys": size}
            report["keys_per_check"].append(r)
            print(f"   {size:>3} keys  {NAMES[model]:<24} {fmt(r)}")

    out = REPO_ROOT / "artifacts" / "reports" / "aalto.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, allow_nan=False))
    print(f"\nWrote {out}")
    if args.no_model:
        return

    # The deployed keyboard model: selected and thresholded on held-out typists, refitted on all.
    held_out = {m: folded(rounds, m) for m in FITS}
    comparison = evaluate(held_out, reps=REPS)
    chosen, reason = select(comparison)
    genuine = np.array([a.score for a in held_out[chosen] if a.genuine])
    impostor = np.array([a.score for a in held_out[chosen] if not a.genuine])
    reject_at, accept_at = choose_thresholds(genuine, impostor)
    version = time.strftime(f"keys-{chosen}-%Y%m%d-%H%M%S")
    summary = {
        "version": version,
        "modality": "keys",
        "source": "aalto",
        "model": NAMES[chosen],
        "selected": {"id": chosen, "name": NAMES[chosen], "reason": reason},
        "window": WINDOW,
        "participants": {"total": n},
        "thresholds": {"reject_at": reject_at, "accept_at": accept_at, "target_error": 0.05},
        "models": [comparison[m] | {"id": m, "name": NAMES[m]} for m in FITS],
        "limitations": report["caveats"]
        + ["Thresholds were set on Aalto typists; they have not been calibrated on people using this app."],
    }
    model = Model(version, FITS[chosen](rounds), reject_at, accept_at, "aalto", summary)
    save(settings.artifacts_dir / "keys" / version, model, feature_names=KEY_FEATURE_NAMES, schema=KEY_SCHEMA)
    print(f"Activated keyboard model {version} ({NAMES[chosen]}; {reason})")


LOGIN_LOW, LOGIN_HIGH, LOGIN_HIDDEN = 15, 45, 0.4
LOGIN_BANDS = ((15, 24), (25, 34), (35, 45))


def login_model(data: dict[str, dict[str, list]]) -> None:
    """A model for the short, partly hidden typing of a sign-in, scored against a profile of
    50-key windows. Separate thresholds, because short probes score differently."""
    rounds = to_short_rounds(data, LOGIN_LOW, LOGIN_HIGH, LOGIN_HIDDEN)
    n = len({r.participant for r in rounds})
    print(f"{n} typists; probes of {LOGIN_LOW}-{LOGIN_HIGH} keys, last {LOGIN_HIDDEN:.0%} with zones hidden\n")
    held_out = {m: folded(rounds, m) for m in FITS}
    comparison = evaluate(held_out, reps=REPS)
    chosen, reason = select(comparison)
    for m in FITS:
        print(f"   {NAMES[m]:<24} {fmt(result(m, held_out[m]))}")
    bands = []
    for low, high in LOGIN_BANDS:
        subset = [a for a in held_out[chosen] if low <= PROBE_KEYS.get((a.claimant, a.at), 0) <= high]
        r = result(chosen, subset) | {"keys": [low, high]}
        bands.append(r)
        print(f"   {low}-{high} keys  {fmt(r)}")
    genuine = np.array([a.score for a in held_out[chosen] if a.genuine])
    impostor = np.array([a.score for a in held_out[chosen] if not a.genuine])
    reject_at, accept_at = choose_thresholds(genuine, impostor)
    version = time.strftime(f"keys-login-{chosen}-%Y%m%d-%H%M%S")
    caveats = [
        "Enrollment and probes come from the same sitting of copied sentences; real sign-ins on other days are harder.",
        "Probes are cut from free sentences, not the same email and password typed every time.",
        "The hidden part simulates a password field (timing only); real passwords are shorter or longer.",
        "Thresholds were set on Aalto typists; they have not been calibrated on people using Cadence.",
    ]
    summary = {
        "version": version,
        "modality": "keys",
        "use": "login",
        "source": "aalto",
        "model": NAMES[chosen],
        "selected": {"id": chosen, "name": NAMES[chosen], "reason": reason},
        "window": WINDOW,
        "probe_keys": [LOGIN_LOW, LOGIN_HIGH],
        "hidden_share": LOGIN_HIDDEN,
        "participants": {"total": n},
        "thresholds": {"reject_at": reject_at, "accept_at": accept_at, "target_error": 0.05},
        "models": [comparison[m] | {"id": m, "name": NAMES[m]} for m in FITS],
        "by_keys": bands,
        "limitations": caveats,
    }
    out = REPO_ROOT / "artifacts" / "reports" / "aalto-login.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2, allow_nan=False))
    model = Model(version, FITS[chosen](rounds), reject_at, accept_at, "aalto", summary)
    save(settings.artifacts_dir / "keys-login" / version, model, feature_names=KEY_FEATURE_NAMES, schema=KEY_SCHEMA)
    print(f"\nActivated login keyboard model {version} ({NAMES[chosen]}; {reason}); report {out}")


if __name__ == "__main__":
    main()
