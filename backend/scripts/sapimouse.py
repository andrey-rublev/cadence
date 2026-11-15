"""SapiMouse: what 120 people say about the model, reported separately from volunteer data.

    uv run python scripts/sapimouse.py --zip ../data/external/sapimouse/sapimouse.zip \
        --db ../data/collected/nathaniels-laptop.db --db ../data/collected/nikhil-laptop.db

SapiMouse (Antal et al., 2021; https://www.ms.sapientia.ro/~manyi/sapimouse/sapimouse.html)
has 120 people, each with a 3-minute and a 1-minute session of free-form mouse use,
recorded on the same day on their own computers. The data licence is not stated, so the
archive is used for research only and never committed (data/external/ is gitignored).

Features are block K (cadence/features/strokes.py): geometry-free stroke features, summed
up over windows of consecutive strokes. Enrollment is the 3-minute session; probes are
windows of the 1-minute session. Because every person used their own computer, genuine
attempts are same-device and impostor attempts are other-device, which flatters results.

1. Learning curve: 5 participant-grouped folds, training on k people from the other folds.
2. Window size: how many strokes (seconds of movement) one check needs.
3. Transfer: models trained on all of SapiMouse, scored on the volunteers (none seen in training).

Writes artifacts/reports/sapimouse.json.
"""

import argparse
import csv
import hashlib
import io
import json
import random
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
from experiments import load_raw  # same directory

from cadence.core.config import REPO_ROOT
from cadence.features.strokes import K_FEATURE_NAMES, strokes, window_vector
from cadence.verifier.baseline import Baseline
from cadence.verifier.data import Round, sessions_by_person
from cadence.verifier.evaluation import Attempt, cross_validate, evaluate
from cadence.verifier.pairwise import fit_pairwise

FOLDS = 5
REPS = 300
WINDOW = 12  # strokes per check, about the number in one Cadence round
KIND = {"Move": 0, "Drag": 0, "Pressed": 1, "Released": 2}

FITS = {
    "b0": lambda rs: Baseline.fit(np.array([r.vector for r in rs])),
    "m2": lambda rs: fit_pairwise(rs, "boosting", negatives_per_template=300),
}
NAMES = {"b0": "B0-K distance", "m2": "M2-K pairwise boosting"}


def load_sapimouse(path: Path) -> dict[str, dict]:
    """user -> {"enroll": strokes of the 3-minute session, "probe": strokes of the 1-minute one, "s_per_stroke"}."""
    sessions: dict[str, dict[str, str]] = defaultdict(dict)
    with zipfile.ZipFile(path) as archive:
        for name in sorted(n for n in archive.namelist() if n.endswith(".csv")):
            user, length = name.split("/")[1], ("3min" if name.endswith("3min.csv") else "1min")
            sessions[user].setdefault(length, name)  # some users have extra sessions; keep the first of each
        data = {}
        for user, files in sessions.items():
            if set(files) != {"1min", "3min"}:
                continue
            parsed = {}
            for length, name in files.items():
                events = []
                for row in csv.DictReader(io.TextIOWrapper(archive.open(name), encoding="utf-8")):
                    left = row["button"] == "Left"
                    kind = KIND.get(row["state"], 0) if left else 0  # only left presses delimit strokes
                    events.append([float(row["client timestamp"]), float(row["x"]), float(row["y"]), kind, int(left)])
                events.sort(key=lambda e: e[0])
                parsed[length] = (strokes(events), (events[-1][0] - events[0][0]) / 1000)
            (enroll, enroll_s), (probe, probe_s) = parsed["3min"], parsed["1min"]
            if len(enroll) >= 2 * WINDOW and len(probe) >= WINDOW:
                data[user] = {"enroll": enroll, "probe": probe, "s_per_stroke": (enroll_s + probe_s) / (len(enroll) + len(probe))}
    return data


def to_rounds(data: dict[str, dict], window: int) -> list[Round]:
    rounds = []
    for user, d in data.items():
        for offset, key in ((0, "enroll"), (1_000_000, "probe")):
            chunks = [d[key][i : i + window] for i in range(0, len(d[key]) - window + 1, window)]
            rounds += [Round(user, "", f"{user}:{key}", offset + i, window_vector(c), user) for i, c in enumerate(chunks)]
    return rounds


def folded(rounds: list[Round], model: str, train_size: int | None = None, seed: int = 0) -> list[Attempt]:
    """Participant-grouped folds; each fold's people are scored against each other by a model
    fitted on (a random `train_size` of) the other folds' people."""
    people = sessions_by_person(rounds)
    order = sorted(people, key=lambda n: hashlib.sha256(f"sapimouse:{n}".encode()).hexdigest())
    rng = random.Random(seed)
    attempts = []
    for k in range(FOLDS):
        fold = order[k::FOLDS]
        rest = [p for p in order if p not in set(fold)]
        train_people = set(rest if train_size is None else rng.sample(rest, train_size))
        verifier = FITS[model]([r for r in rounds if r.participant in train_people])
        for target in fold:
            enrollment = np.array([r.vector for s in people[target] for r in s if r.session.endswith(":enroll")])
            if not enrollment.size:
                continue
            for claimant in fold:
                # Only the 1-minute session. A person whose 1-minute session is shorter than one
                # window has no probe at all; never fall back to their enrollment windows.
                probes = [r for s in people[claimant] for r in s if r.session.endswith(":probe")]
                if not probes:
                    continue
                scores = verifier.score_many(enrollment, np.array([r.vector for r in probes]))
                attempts += [
                    Attempt(target, claimant, float(s), r.session, r.at, claimant == target)
                    for r, s in zip(probes, scores)
                    if np.isfinite(s)
                ]
    return attempts


def result(model: str, attempts: list[Attempt]) -> dict:
    entry = evaluate({model: attempts}, reps=REPS)[model]
    return {
        "model": model,
        "auc": entry["one_round"]["auc"],
        "eer": entry["one_round"]["eer"],
        "auc_3": entry["three_rounds"]["auc"],
        "genuine_attempts": entry["counts"]["genuine_attempts"],
        "impostor_attempts": entry["counts"]["impostor_attempts"],
    }


def fmt(r: dict) -> str:
    a, three = r["auc"], r.get("auc_3") or {}
    text = f"AUC {a['value']:.2f} ({a['low']:.2f}-{a['high']:.2f})  EER {r['eer']['value']:.0%}"
    return text + (f"  3 windows AUC {three['value']:.2f}" if three.get("value") is not None else "")


def volunteer_k_rounds(databases: list[Path]) -> list[Round]:
    """Block K for each volunteer round: one window made of all of that round's strokes."""
    return [
        Round(r["participant"], "", r["session"], r["at"], window_vector(strokes(r["events"])), r["station"])
        for r in load_raw(databases)
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zip", type=Path, required=True, help="sapimouse.zip, downloaded from the dataset page")
    parser.add_argument("--db", type=Path, action="append", default=[], help="volunteer databases for the transfer test")
    args = parser.parse_args()

    data = load_sapimouse(args.zip)
    s_per_stroke = float(np.median([d["s_per_stroke"] for d in data.values()]))
    rounds = to_rounds(data, WINDOW)
    report: dict = {
        "dataset": "SapiMouse (Antal et al. 2021), 3-minute enrollment and 1-minute probe session per person",
        "people": len(data),
        "features": list(K_FEATURE_NAMES),
        "window_strokes": WINDOW,
        "seconds_per_stroke": round(s_per_stroke, 2),
        "caveats": [
            "Each person used their own computer: genuine attempts are same-device and impostors are other-device, so device differences help.",
            "Both sessions were recorded on the same day.",
            "Free-form use with no target geometry, so only geometry-free features (block K) apply.",
        ],
    }
    print(f"{len(data)} people, {len(rounds)} windows of {WINDOW} strokes (~{WINDOW * s_per_stroke:.0f} s each)\n")

    print("1. Training people (5 folds; scored people never in training)")
    report["learning_curve"] = []
    for k in (5, 10, 20, 40, None):
        for model in FITS:
            seeds = range(2) if k else range(1)
            r = result(model, [a for seed in seeds for a in folded(rounds, model, k, seed)])
            r["training_people"] = k or len(data) * (FOLDS - 1) // FOLDS
            report["learning_curve"].append(r)
            print(f"   {r['training_people']:>3} people  {NAMES[model]:<24} {fmt(r)}")

    print("\n2. Strokes per check (all other folds for training)")
    report["window_size"] = []
    # 48 strokes is not measurable: the 1-minute probe session has a median of 42 strokes.
    for window in (3, 6, 12, 24):
        windowed = to_rounds(data, window)
        probe_windows = defaultdict(int)
        for r in windowed:
            probe_windows[r.participant] += r.session.endswith(":probe")
        probed = sum(n >= 1 for n in probe_windows.values())
        with_three = sum(n >= 3 for n in probe_windows.values())
        for model in FITS:
            r = result(model, folded(windowed, model))
            r |= {"strokes": window, "seconds": round(window * s_per_stroke, 1), "people_with_a_probe": probed}
            if with_three < 30:  # three-window decisions would come from a few fast clickers only
                r["auc_3"] = None
            report["window_size"].append(r)
            print(f"   {window:>2} strokes (~{window * s_per_stroke:>4.0f} s, {probed} people)  {NAMES[model]:<24} {fmt(r)}")

    if args.db:
        print("\n3. Transfer to the volunteers (enroll session 1, probe session 2, one round)")
        volunteers = volunteer_k_rounds(args.db)
        report["transfer"] = []
        for model in FITS:
            pretrained = FITS[model](rounds)
            for label, fit in (("trained on SapiMouse only", lambda rs, v=pretrained: v), ("trained on volunteers only", FITS[model])):
                attempts, protocol = cross_validate(volunteers, fit)
                r = result(model, attempts) | {"training": label, "protocol": protocol}
                report["transfer"].append(r)
                print(f"   {NAMES[model]:<24} {label:<28} {fmt(r)}")

    out = REPO_ROOT / "artifacts" / "reports" / "sapimouse.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, allow_nan=False))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
