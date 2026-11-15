"""Questions about the model, answered on participant-held-out volunteers.

    uv run python scripts/experiments.py --db ../data/collected/a.db --db ../data/collected/b.db

1. Learning curve: does training on more people help a new person?
2. Enrollment size: how many enrollment rounds are enough?
3. Second session: how much does scoring against a different sitting change things?
4. Short interactions: how well do the first few seconds of movement work on their own
   (a stand-in for passive checks while someone opens the app and signs in)?

Every score comes from a model fitted without the people being scored. AUC ranges are 95%
participant-bootstrap intervals. Writes artifacts/reports/experiments.json.
"""

import argparse
import json
import random
import sqlite3
import zlib
from collections.abc import Callable
from pathlib import Path

import numpy as np

from cadence.core.config import REPO_ROOT
from cadence.features.extract import extract_round, to_vector
from cadence.verifier.data import Round, Verifier, sessions_by_person
from cadence.verifier.evaluation import Attempt, evaluate
from cadence.verifier.pairwise import NotTrainable
from cadence.verifier.training import CANDIDATES

MODELS = ("b0", "m2")
REPS = 500

# Which parts of a round to keep. c0 (the click that starts the round) is always kept.
VARIANTS: dict[str, dict] = {
    "first 2 clicks": {"clicks": 2, "drags": False, "track": False},
    "first 4 clicks": {"clicks": 4, "drags": False, "track": False},
    "all 8 clicks": {"clicks": 8, "drags": False, "track": False},
    "clicks and drags": {"clicks": 8, "drags": True, "track": False},
    "full round": {"clicks": 8, "drags": True, "track": True},
}


def load_raw(databases: list[Path]) -> list[dict]:
    raw = []
    for index, path in enumerate(databases):
        with sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True) as db:
            rows = db.execute(
                """
                SELECT p.username, s.session_id, s.captured_at, s.events_z, s.timeline_json, c.layout_json, ss.station
                FROM samples s
                JOIN participants p ON p.id = s.participant_id
                JOIN challenges c ON c.id = s.challenge_id
                LEFT JOIN sessions ss ON ss.id = s.session_id
                WHERE s.is_warmup = 0 AND s.source = 'volunteer' AND s.events_z IS NOT NULL AND p.is_pilot = 0
                """
            ).fetchall()
        for username, session_id, at, events_z, timeline, layout, station in rows:
            raw.append({
                "participant": username, "session": f"{index}:{session_id}", "at": at,
                "station": f"{Path(path).stem}/{station or '?'}",
                "layout": json.loads(layout), "events": json.loads(zlib.decompress(events_z)),
                "timeline": json.loads(timeline),
            })  # fmt: skip
    return raw


def truncate(timeline: list[dict], clicks: int, drags: bool, track: bool) -> list[dict]:
    kept, seen = [], 0
    for step in timeline:
        if step["kind"] == "click":
            if seen <= clicks:
                kept.append(step)
            seen += 1
        elif (step["kind"] == "drag" and drags) or (step["kind"] == "track" and track):
            kept.append(step)
    return kept


def build(raw: list[dict], variant: dict) -> tuple[list[Round], float]:
    """Rounds with features from only the kept steps, and the median seconds of movement they cover."""
    rounds, seconds = [], []
    for r in raw:
        steps = truncate(r["timeline"], **variant)
        features = extract_round(r["layout"], r["events"], steps)
        rounds.append(Round(r["participant"], "", r["session"], r["at"], to_vector(features), r["station"]))
        seconds.append((max(s["t_end"] for s in steps) - steps[0]["t_end"]) / 1000)
    return rounds, float(np.median(seconds))


class Fits:
    """Fitted verifiers, cached by (variant, model, training people)."""

    def __init__(self) -> None:
        self.cache: dict = {}

    def get(self, variant: str, model: str, rounds: list[Round], people: list[str]) -> Verifier | None:
        key = (variant, model, frozenset(people))
        if key not in self.cache:
            train = [r for r in rounds if r.participant in key[2]]
            try:
                self.cache[key] = CANDIDATES[model][1](train)
            except NotTrainable:
                self.cache[key] = None
        return self.cache[key]


Select = Callable[[list[list[Round]]], list[Round]]


def held_out(
    fits: Fits, variant: str, model: str, rounds: list[Round],
    enroll: Select, genuine: Select, train_size: int | None = None, seed: int = 0,
) -> list[Attempt]:  # fmt: skip
    """Genuine scores from a fit without the target; impostor scores from a fit without the
    target and the impostor. With `train_size`, each fit uses that many random other people."""
    people = sessions_by_person(rounds)
    names = sorted(people)
    rng = random.Random(seed)
    attempts: list[Attempt] = []

    def pool(excluded: set[str]) -> list[str]:
        rest = [p for p in names if p not in excluded]
        return rest if train_size is None else rng.sample(rest, min(train_size, len(rest)))

    def add(verifier: Verifier | None, target: str, enrollment: list[Round], probes: list[Round]) -> None:
        if verifier is None or not probes or not enrollment:
            return
        scores = verifier.score_many(np.array([r.vector for r in enrollment]), np.array([r.vector for r in probes]))
        attempts.extend(
            Attempt(target, r.participant, float(s), r.session, r.at, r.station == enrollment[0].station)
            for r, s in zip(probes, scores)
            if np.isfinite(s)
        )

    for target in (p for p in names if len(people[p]) >= 2):
        enrollment = enroll(people[target])
        add(fits.get(variant, model, rounds, pool({target})), target, enrollment, genuine(people[target]))
        for other in names:
            if other != target:
                probes = [r for s in people[other] for r in s]
                add(fits.get(variant, model, rounds, pool({target, other})), target, enrollment, probes)
    return attempts


def auc_of(model: str, attempts: list[Attempt]) -> dict:
    entry = evaluate({model: attempts}, reps=REPS)[model]
    return {
        "auc": entry["one_round"]["auc"],
        "eer": entry["one_round"]["eer"],
        "genuine_attempts": entry["counts"]["genuine_attempts"],
        "impostor_attempts": entry["counts"]["impostor_attempts"],
    }


first_session: Select = lambda sessions: sessions[0]  # noqa: E731
later_sessions: Select = lambda sessions: [r for s in sessions[1:] for r in s]  # noqa: E731


def fmt(result: dict) -> str:
    a = result["auc"]
    return f"AUC {a['value']:.2f} ({a['low']:.2f}-{a['high']:.2f})  EER {result['eer']['value']:.0%}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, action="append", required=True)
    args = parser.parse_args()

    raw = load_raw(args.db)
    built = {name: build(raw, variant) for name, variant in VARIANTS.items()}
    full, full_seconds = built["full round"]
    people = sessions_by_person(full)
    fits = Fits()
    report: dict = {
        "people": len(people),
        "with_two_sessions": sum(len(s) >= 2 for s in people.values()),
        "rounds": len(full),
        "note": "Held-out volunteers only; AUC ranges are 95% participant-bootstrap intervals.",
    }

    print(f"{report['people']} people, {report['with_two_sessions']} with two sessions, {report['rounds']} rounds\n")

    print("1. Training people (enroll on session 1, probe with session 2, one round)")
    report["learning_curve"] = []
    for k in (2, 4, 6, 8):
        for model in MODELS:
            seeds = range(3) if k < 8 else range(1)
            attempts = [a for seed in seeds for a in held_out(fits, "full round", model, full, first_session, later_sessions, k, seed)]
            result = auc_of(model, attempts) | {"model": model, "training_people": k}
            report["learning_curve"].append(result)
            print(f"   {k} training people  {model}: {fmt(result)}")

    print("\n2. Enrollment size (probe with session 2, one round)")
    report["enrollment_size"] = []
    for k in (1, 2, 3, 6):
        for model in MODELS:
            result = auc_of(model, held_out(fits, "full round", model, full, lambda s, k=k: s[0][:k], later_sessions))
            result |= {"model": model, "enrollment_rounds": k, "enrollment_seconds": round(k * full_seconds)}
            report["enrollment_size"].append(result)
            print(f"   {k} rounds (~{k * full_seconds:.0f} s)  {model}: {fmt(result)}")

    print("\n3. Same sitting or a second session (enroll on rounds 1-3 of session 1)")
    report["second_session"] = []
    for label, genuine in (("same sitting (rounds 4-6)", lambda s: s[0][3:]), ("second session, other laptop", later_sessions)):
        for model in MODELS:
            result = auc_of(model, held_out(fits, "full round", model, full, lambda s: s[0][:3], genuine))
            result |= {"model": model, "probe": label}
            report["second_session"].append(result)
            print(f"   {label}  {model}: {fmt(result)}")

    print("\n4. How much movement per check (enroll on session 1, one probe from session 2)")
    report["short_interaction"] = []
    for name, (rounds, seconds) in built.items():
        for model in MODELS:
            result = auc_of(model, held_out(fits, name, model, rounds, first_session, later_sessions))
            result |= {"model": model, "variant": name, "seconds": round(seconds, 1)}
            report["short_interaction"].append(result)
            print(f"   {name} (~{seconds:.1f} s)  {model}: {fmt(result)}")

    out = REPO_ROOT / "artifacts" / "reports" / "experiments.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, allow_nan=False))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
