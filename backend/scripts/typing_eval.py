"""Volunteer typing: how the keyboard model does on real people across sessions, and calibration.

    uv run python scripts/typing_eval.py --db ../data/collected/a.db --db ../data/collected/b.db
    uv run python scripts/typing_eval.py --db ... --calibrate

Compares, on participant-held-out scores (same protocol as scripts/train.py):
- the active keyboard model trained on Aalto, used as it is (nobody here was in its training);
- B0 and M2 trained on the volunteers themselves.
Each person enrolls on their first session; later sessions (ideally on other days) are probes.

--calibrate keeps the Aalto-trained model but re-chooses its thresholds on the volunteers'
held-out cross-session scores, and activates that as a new keyboard model version. It refuses
when there are too few people with two sessions.
"""

import argparse
import json
import sqlite3
import time
from pathlib import Path

import numpy as np

from cadence.core.config import settings
from cadence.features.keys import KEY_FEATURE_NAMES, KEY_SCHEMA
from cadence.passive import passive_model
from cadence.verifier.artifact import Model, save
from cadence.verifier.data import Round, sessions_by_person
from cadence.verifier.evaluation import cross_validate, evaluate, select
from cadence.verifier.metrics import choose_thresholds
from cadence.verifier.training import CANDIDATES, MIN_GENUINE, MIN_IMPOSTOR, MIN_TARGETS


def load_typing(databases: list[Path], include_pilots: bool = False) -> list[Round]:
    rounds = []
    for path in databases:
        with sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True) as db:
            has_table = db.execute("SELECT 1 FROM sqlite_master WHERE name = 'passive_windows'").fetchone()
            if not has_table:
                continue
            rows = db.execute(
                """
                SELECT p.username, p.is_pilot, w.session_id, w.captured_at, w.values_json, s.station
                FROM passive_windows w
                JOIN participants p ON p.id = w.participant_id
                LEFT JOIN sessions s ON s.id = w.session_id
                WHERE w.purpose = 'collect' AND w.modality = 'keys' AND w.feature_schema = ?
                """,
                (KEY_SCHEMA,),
            ).fetchall()
        for username, is_pilot, session_id, at, values, station in rows:
            if is_pilot and not include_pilots:
                continue
            vector = np.array(json.loads(values), dtype=float)
            rounds.append(Round(username, "", f"{Path(path).stem}:{session_id}", at, vector, f"{Path(path).stem}/{station}"))
    return rounds


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, action="append", required=True)
    parser.add_argument("--calibrate", action="store_true", help="re-threshold the Aalto model on volunteer data")
    parser.add_argument("--include-pilots", action="store_true")
    args = parser.parse_args()

    rounds = load_typing(args.db, args.include_pilots)
    people = sessions_by_person(rounds)
    targets = [p for p, s in people.items() if len(s) >= 2]
    print(f"{len(people)} volunteers ({len(targets)} with two or more sessions), {len(rounds)} typing samples\n")
    if len(targets) < 2 or len(people) < 3:
        print("Too few volunteers with two sessions to evaluate anything yet.")
        return

    pretrained = passive_model("keys")
    fits = {f"{m}-volunteers": CANDIDATES[m][1] for m in ("b0", "m2")}
    if pretrained is not None:
        fits = {"aalto": lambda rs, v=pretrained.verifier: v} | fits
    attempts = {}
    for name, fit in fits.items():
        try:
            attempts[name], protocol = cross_validate(rounds, fit)
        except ValueError as error:
            print(f"{name}: not trainable ({error})")
    report = evaluate(attempts, reps=500)
    for name, entry in report.items():
        a, e, p = entry["one_round"]["auc"], entry["one_round"]["eer"], entry["policy"]
        print(
            f"{name:<16} AUC {a['value']:.3f} ({a['low']:.2f}-{a['high']:.2f})  EER {e['value']:.1%}  "
            f"genuine {entry['counts']['genuine_attempts']}, impostor {entry['counts']['impostor_attempts']}"
        )
        if name == "aalto" and pretrained is not None:
            g = np.array([x.score for x in attempts[name] if x.genuine])
            i = np.array([x.score for x in attempts[name] if not x.genuine])
            print(
                f"{'':<16} with the Aalto thresholds: impostors above accept {np.mean(i > pretrained.accept_at):.1%}, "
                f"owners below reject {np.mean(g < pretrained.reject_at):.1%}"
            )
    print(f"\nprotocol: {protocol}; ranges are 95% participant-bootstrap intervals")

    if not args.calibrate:
        return
    if pretrained is None:
        print("\nNo active keyboard model to calibrate. Run scripts/aalto.py first.")
        return
    counts = report["aalto"]["counts"]
    if counts["targets"] < MIN_TARGETS or counts["genuine_attempts"] < MIN_GENUINE or counts["impostor_attempts"] < MIN_IMPOSTOR:
        print(
            f"\nNot calibrated: need {MIN_TARGETS} volunteers with two sessions, {MIN_GENUINE} genuine and "
            f"{MIN_IMPOSTOR} impostor attempts (have {counts['targets']}, {counts['genuine_attempts']}, {counts['impostor_attempts']})."
        )
        return
    genuine = np.array([x.score for x in attempts["aalto"] if x.genuine])
    impostor = np.array([x.score for x in attempts["aalto"] if not x.genuine])
    reject_at, accept_at = choose_thresholds(genuine, impostor)
    version = time.strftime("keys-calibrated-%Y%m%d-%H%M%S")
    summary = dict(pretrained.summary)
    summary |= {
        "version": version,
        "source": "aalto+volunteers",
        "thresholds": {"reject_at": reject_at, "accept_at": accept_at, "target_error": 0.05},
        "calibration": {
            "volunteers": len(people),
            "with_two_sessions": len(targets),
            "result": report["aalto"],
            "aalto_thresholds": {"reject_at": pretrained.reject_at, "accept_at": pretrained.accept_at},
        },
        "limitations": [
            line for line in pretrained.summary.get("limitations", []) if "not been calibrated" not in line
        ]
        + [f"Thresholds recalibrated on {len(targets)} volunteers' held-out cross-session typing."],
    }
    model = Model(version, pretrained.verifier, reject_at, accept_at, "aalto+volunteers", summary)
    save(settings.artifacts_dir / "keys" / version, model, feature_names=KEY_FEATURE_NAMES, schema=KEY_SCHEMA)
    print(f"\nActivated {version}: reject below {reject_at:.2f}, accept above {accept_at:.2f}")


if __name__ == "__main__":
    main()
