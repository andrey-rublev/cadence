"""Password rhythm on the CMU keystroke benchmark, and the model that compares a sign-in's
password typing with the person's earlier sign-ins on the same site.

    uv run python scripts/cmu_rhythm.py --csv ../data/external/cmu/DSL-StrongPasswordData.csv

Dataset: Killourhy and Maxion, Comparing Anomaly-Detection Algorithms for Keystroke Dynamics,
DSN 2009. https://www.cs.cmu.edu/~keystroke/ . 51 typists each typed the same password
(".tie5Roanl") 400 times over 8 sessions at least a day apart. Timing only; never committed
(data/external/ is gitignored).

Unlike Aalto, the text repeats, which is what a sign-in does. Each typist's sign-ins are
replayed the way the product sees them:
- "practice": the earlier sign-ins are 3 consecutive repetitions from one session (the three
  practice sign-ins right after linking); new sign-ins come from later sessions;
- "history": the earlier sign-ins are the latest 5, one from each of the 5 previous sessions;
  the new sign-in comes from the next session.
Impostors are other typists typing the same password: people who know it and have typed it
hundreds of times themselves, a harder case than someone who has just learned it.

Passwords vary in length, so the comparison is measured on the first 6, 8 and 10 keys, and
thresholds are kept per length and per number of earlier sign-ins (3 or 5). The one free setting (how far the spread of a few earlier
sign-ins is floored) is chosen on one half of the typists; everything reported, and the
thresholds, come from the other half.
"""

import argparse
import csv
import hashlib
import json
import random
import time
from pathlib import Path

import numpy as np

from cadence.core.config import REPO_ROOT, settings
from cadence.features.keys import SECRET
from cadence.features.rhythm import RHYTHM_SCHEMA, RhythmVerifier, rhythm_vector
from cadence.verifier.artifact import Model, save
from cadence.verifier.evaluation import Attempt, evaluate
from cadence.verifier.metrics import choose_thresholds, equal_error_rate

KEYS = ("period", "t", "i", "e", "five", "Shift.r", "o", "a", "n", "l")  # Return is not in a password field
LENGTHS = (6, 8, 10)
FLOORS_MS = (0.0, 5.0, 10.0, 20.0, 40.0)
FLOOR_SHARES = (0.0, 0.05, 0.1, 0.2)
IMPOSTORS = 20  # other typists per target
IMPOSTOR_REPS = 10
GENUINE_REPS = 40
EARLIER = {"practice": 3, "history": 5}  # earlier sign-ins per condition
REPS = 300
FEATURE_NAMES = ("rhythm",)  # variable length; the schema number is what guards compatibility


def load(path: Path) -> dict[str, dict[int, list[list[tuple[float, float, int]]]]]:
    """subject -> session -> repetitions, each a list of presses (down_ms, up_ms, SECRET)."""
    out: dict[str, dict[int, list]] = {}
    with path.open() as f:
        for row in csv.DictReader(f):
            down, presses = 0.0, []
            for i, key in enumerate(KEYS):
                hold = float(row[f"H.{key}"]) * 1000
                presses.append((down, down + hold, SECRET))
                if i + 1 < len(KEYS):
                    down += float(row[f"DD.{key}.{KEYS[i + 1]}"]) * 1000
            out.setdefault(row["subject"], {}).setdefault(int(row["sessionIndex"]), []).append(presses)
    return out


def vec(presses: list, n: int) -> np.ndarray:
    return rhythm_vector(presses[:n])


def attempts_for(
    data: dict, subjects: list[str], verifier: RhythmVerifier, n: int, condition: str, seed: int
) -> list[Attempt]:
    rng = random.Random(seed)
    out: list[Attempt] = []
    for target in subjects:
        sessions = data[target]
        if condition == "practice":
            s = rng.randint(2, 7)
            start = rng.randint(0, len(sessions[s]) - 3)
            templates = [vec(p, n) for p in sessions[s][start : start + 3]]
            later = [p for t in range(s + 1, 9) for p in sessions[t]]
            probe_session = None
        else:
            s = rng.randint(6, 8)
            templates = [vec(rng.choice(sessions[t]), n) for t in range(s - 5, s)]
            later = sessions[s]
            probe_session = s
        genuine = rng.sample(later, min(GENUINE_REPS, len(later)))
        template = np.array(templates)
        scores = verifier.score_many(template, np.array([vec(p, n) for p in genuine]))
        out += [Attempt(target, target, float(x), f"{target}:probe", i, True) for i, x in enumerate(scores)]
        others = rng.sample([p for p in subjects if p != target], min(IMPOSTORS, len(subjects) - 1))
        for claimant in others:
            pool = data[claimant][probe_session] if probe_session else [p for t in range(2, 9) for p in data[claimant][t]]
            reps = rng.sample(pool, IMPOSTOR_REPS)
            scores = verifier.score_many(template, np.array([vec(p, n) for p in reps]))
            out += [Attempt(target, claimant, float(x), f"{claimant}:probe", i, True) for i, x in enumerate(scores)]
    return out


def split(attempts: list[Attempt]) -> tuple[np.ndarray, np.ndarray]:
    return (
        np.array([a.score for a in attempts if a.genuine]),
        np.array([a.score for a in attempts if not a.genuine]),
    )


def rates(attempts: list[Attempt], reject_at: float, accept_at: float) -> dict:
    genuine, impostor = split(attempts)
    return {
        "genuine_accepted": float((genuine > accept_at).mean()),
        "genuine_rejected": float((genuine < reject_at).mean()),
        "impostor_accepted": float((impostor > accept_at).mean()),
        "impostor_rejected": float((impostor < reject_at).mean()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--no-model", action="store_true", help="measure only")
    args = parser.parse_args()

    data = load(args.csv)
    order = sorted(data, key=lambda s: hashlib.sha256(f"cmu:{s}".encode()).hexdigest())
    tune, held = order[::2], order[1::2]
    print(f"{len(data)} typists: {len(tune)} to choose the floor, {len(held)} held out\n")

    # 1. The floor, chosen on the tuning half by mean EER over lengths and conditions.
    grid = []
    for floor_ms in FLOORS_MS:
        for share in FLOOR_SHARES:
            v = RhythmVerifier(floor_ms, share)
            eers = [
                equal_error_rate(*split(attempts_for(data, tune, v, n, c, seed=1)))
                for n in LENGTHS
                for c in ("practice", "history")
            ]
            grid.append({"floor_ms": floor_ms, "floor_share": share, "mean_eer": float(np.mean(eers))})
    best = min(grid, key=lambda g: g["mean_eer"])
    print(f"1. Floor chosen on the tuning half: {best['floor_ms']:.0f} ms + {best['floor_share']:.0%} of the mean"
          f" (mean EER {best['mean_eer']:.1%})\n")  # fmt: skip
    verifier = RhythmVerifier(best["floor_ms"], best["floor_share"])

    # 2. Held-out typists: accuracy and thresholds per length and number of earlier sign-ins.
    print("2. Held-out typists")
    by_length: list[dict] = []
    thresholds: dict[int, dict[int, tuple[float, float]]] = {EARLIER[c]: {} for c in EARLIER}
    for n in LENGTHS:
        per = {c: attempts_for(data, held, verifier, n, c, seed=2) for c in EARLIER}
        report = evaluate({"b0": per["practice"], "history": per["history"]}, reps=REPS)
        entry: dict = {"keys": n}
        for c, key in (("practice", "b0"), ("history", "history")):
            reject_at, accept_at = choose_thresholds(*split(per[c]))
            thresholds[EARLIER[c]][n] = (reject_at, accept_at)
            one = report[key]["one_round"]
            entry[c] = {
                "earlier_sign_ins": EARLIER[c],
                "auc": one["auc"],
                "eer": one["eer"],
                "thresholds": {"reject_at": reject_at, "accept_at": accept_at, "target_error": 0.05},
                "at_thresholds": rates(per[c], reject_at, accept_at),
            }
            r = entry[c]["at_thresholds"]
            print(f"   {n:>2} keys  {c:<8}  AUC {one['auc']['value']:.3f} ({one['auc']['low']:.3f}-{one['auc']['high']:.3f})"
                  f"  EER {one['eer']['value']:.1%}  owner released {r['genuine_accepted']:.0%}, held {r['genuine_rejected']:.0%};"
                  f" impostor released {r['impostor_accepted']:.1%}")  # fmt: skip
        by_length.append(entry)

    verifier.thresholds = thresholds
    version = time.strftime("rhythm-sm-%Y%m%d-%H%M%S")
    longest = thresholds[EARLIER["practice"]][max(LENGTHS)]
    summary = {
        "version": version,
        "modality": "rhythm",
        "use": "password",
        "source": "cmu",
        "dataset": "CMU keystroke benchmark (Killourhy and Maxion, DSN 2009): 51 typists, one password, 400 repetitions over 8 sessions",
        "model": "Scaled Manhattan distance to the earlier sign-ins, floored spread",
        "floor": best,
        "floor_grid": grid,
        "participants": {"total": len(data), "tuning": len(tune), "held_out": len(held)},
        "thresholds_by_earlier_and_keys": {
            str(k): {str(n): {"reject_at": r, "accept_at": a} for n, (r, a) in by.items()} for k, by in thresholds.items()
        },
        "thresholds": {
            "reject_at": longest[0],
            "accept_at": longest[1],
            "target_error": 0.05,
            "applies_to": f"3 earlier sign-ins, {max(LENGTHS)} or more keys (others in thresholds_by_earlier_and_keys)",
        },
        "by_keys": by_length,
        "limitations": [
            "One password for everyone, typed by people who practised it hundreds of times; real passwords differ per person and impostors usually know them less well.",
            "Lab keyboards, one per typist; a different keyboard or device on a real sign-in will score lower.",
            "Passwords shorter than 6 keys are not compared; beyond 10 keys the 10-key thresholds are used, and with 4 earlier sign-ins the 3-sign-in ones.",
            "The general sign-in model cannot be measured on CMU (no free typing), so the product's rule for combining the two was not measured together.",
            "Thresholds were set on CMU typists; they have not been calibrated on people using Cadence.",
        ],
    }
    out = REPO_ROOT / "artifacts" / "reports" / "cmu-rhythm.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2, allow_nan=False))
    print(f"\nWrote {out}")
    if args.no_model:
        return
    model = Model(version, verifier, longest[0], longest[1], "cmu", summary)
    save(settings.artifacts_dir / "rhythm" / version, model, feature_names=FEATURE_NAMES, schema=RHYTHM_SCHEMA)
    print(f"Activated password rhythm model {version}")


if __name__ == "__main__":
    main()
