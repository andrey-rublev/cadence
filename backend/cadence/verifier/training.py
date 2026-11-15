"""Train, evaluate and select a verifier from volunteer rounds.

Every candidate (B0, M1, M2) is evaluated the same way, on participant-held-out scores
(see evaluation.py). A learned model replaces B0 only when its paired AUC gain has a 95%
interval above zero. The deployed thresholds are chosen on the selected model's held-out
scores; the deployed model is then refitted on everyone.
"""

import json
import random
import sqlite3
import time
import zlib
from collections.abc import Callable
from pathlib import Path

import numpy as np

from ..challenges.replay import replay_round
from ..challenges.spec import generate_layout
from ..features.extract import FEATURE_SCHEMA, extract_round, to_vector
from ..synthetic import SyntheticProfile, simulate_round
from .artifact import Model
from .baseline import Baseline
from .data import Round, Verifier, sessions_by_person
from .evaluation import POLICY_ROUNDS, TARGET_ERROR, cross_validate, evaluate, select
from .metrics import choose_thresholds
from .pairwise import NotTrainable, fit_pairwise

__all__ = ["Round", "load_volunteer_rounds", "synthetic_rounds", "train", "CANDIDATES"]

# Below these counts a threshold or an error rate is noise, so no model is activated.
MIN_TARGETS = 5
MIN_GENUINE = 10
MIN_IMPOSTOR = 30

CANDIDATES: dict[str, tuple[str, Callable[[list[Round]], Verifier]]] = {
    "b0": ("B0 scaled Manhattan distance", lambda rs: Baseline.fit(np.array([r.vector for r in rs]))),
    "m1": ("M1 pairwise logistic regression", lambda rs: fit_pairwise(rs, "logistic")),
    "m2": ("M2 pairwise gradient boosting", lambda rs: fit_pairwise(rs, "boosting")),
}


def load_volunteer_rounds(databases: list[Path], include_pilots: bool = False) -> list[Round]:
    """Scored volunteer rounds from one or more collection laptops, merged by username."""
    rounds = []
    for index, path in enumerate(databases):
        with sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True) as db:
            rows = db.execute(
                """
                SELECT p.username, p.split, p.is_pilot, s.session_id, s.captured_at,
                       s.events_z, s.timeline_json, c.layout_json, ss.station
                FROM samples s
                JOIN participants p ON p.id = s.participant_id
                JOIN challenges c ON c.id = s.challenge_id
                LEFT JOIN sessions ss ON ss.id = s.session_id
                WHERE s.is_warmup = 0 AND s.source = 'volunteer' AND s.events_z IS NOT NULL
                """
            ).fetchall()
        for username, split, is_pilot, session_id, at, events_z, timeline, layout, station in rows:
            if is_pilot and not include_pilots:
                continue
            features = extract_round(json.loads(layout), json.loads(zlib.decompress(events_z)), json.loads(timeline))
            rounds.append(
                Round(username, split, f"{index}:{session_id}", at, to_vector(features), f"{Path(path).stem}/{station or '?'}")
            )
    return rounds


def synthetic_rounds(people: int, seed: int = 0) -> list[Round]:
    """SYNTHETIC players for pipeline checks. Never evidence about real people."""
    rng = random.Random(seed)
    rounds = []
    for person in range(people):
        profile = SyntheticProfile.random(rng)
        split = ("train", "train", "train", "validation", "test")[person % 5]
        for session in range(2):
            for index in range(6):
                layout = generate_layout(rng.getrandbits(40))
                events = simulate_round(layout, profile, rng)
                replay = replay_round(layout, events, events[-1][0] + 500)
                features = extract_round(layout, events, replay.timeline)
                rounds.append(
                    Round(f"synthetic{person}", split, f"{person}:{session}", session * 100 + index, to_vector(features), "synthetic")
                )
    return rounds


def train(
    rounds: list[Round],
    source: str,
    candidates: tuple[str, ...] = tuple(CANDIDATES),
    reps: int = 1000,
) -> tuple[Model | None, dict]:
    """Returns (model, summary). The model is None when the data cannot support thresholds."""
    people = sessions_by_person(rounds)
    targets = [p for p, sessions in people.items() if len(sessions) >= 2]
    summary: dict = {
        "source": source,
        "feature_schema": FEATURE_SCHEMA,
        "participants": {"total": len(people), "with_two_sessions": len(targets)},
        "rounds": len(rounds),
        "stations": sorted({r.station for r in rounds}),
        "limitations": [],
    }
    if source == "synthetic":
        summary["limitations"].append("Trained on synthetic players. These numbers say nothing about real people.")
    if len(targets) < 2 or len(people) < 3:
        summary["limitations"].append(
            "Need at least three people, two of them with two sessions, before anything can be evaluated. No model was activated."
        )
        return None, summary

    attempts, names = {}, {}
    for model_id in candidates:
        name, fit = CANDIDATES[model_id]
        try:
            attempts[model_id], protocol = cross_validate(rounds, fit)
        except NotTrainable as error:
            summary["limitations"].append(f"{name} could not be trained: {error}.")
            continue
        names[model_id] = name
        summary["protocol"] = {
            "name": protocol,
            "description": (
                "Every score comes from a model that never saw the people involved. Each person enrolls on "
                "their first session; later sessions are genuine attempts and every other person's rounds are "
                "impostor attempts. Thresholds applied to a person come from the other people's attempts. "
                f"Decisions replay the product policy: up to {POLICY_ROUNDS} rounds, mean score against the "
                "thresholds. Intervals are 95% participant-bootstrap intervals."
            ),
        }

    report = evaluate(attempts, reps=reps)
    for model_id, entry in report.items():
        entry["id"], entry["name"] = model_id, names[model_id]
    summary["models"] = [report[m] for m in candidates if m in report]
    if not report:
        summary["limitations"].append("No candidate model could be trained. No model was activated.")
        return None, summary

    chosen, reason = select(report)
    entry = report[chosen]
    summary["selected"] = {"id": chosen, "name": names[chosen], "reason": reason}
    counts = entry["counts"]
    reliable = counts["targets"] >= MIN_TARGETS and counts["genuine_attempts"] >= MIN_GENUINE and counts["impostor_attempts"] >= MIN_IMPOSTOR
    summary["reliable"] = reliable
    if not reliable:
        summary["limitations"].append(
            f"Too little held-out evidence to set thresholds (need {MIN_TARGETS} people with two sessions, "
            f"{MIN_GENUINE} genuine and {MIN_IMPOSTOR} impostor attempts). No model was activated."
        )
        return None, summary

    genuine = np.array([a.score for a in attempts[chosen] if a.genuine])
    impostor = np.array([a.score for a in attempts[chosen] if not a.genuine])
    reject_at, accept_at = choose_thresholds(genuine, impostor, TARGET_ERROR)
    summary["thresholds"] = {"reject_at": reject_at, "accept_at": accept_at, "target_error": TARGET_ERROR}

    if counts["targets"] < 30:
        summary["limitations"].append(
            f"Only {counts['targets']} people have two sessions, so every interval is wide. "
            "Read the ranges, not the point values."
        )
    if counts["genuine_same_station"] == 0:
        summary["limitations"].append(
            "Every genuine attempt was recorded on a different laptop from the enrollment, so owner results "
            "include a device change. Impostors on the owner's own laptop are the harder case; see the station breakdown."
        )
    elif counts["genuine_same_station"] < counts["genuine_attempts"]:
        summary["limitations"].append(
            "Some genuine attempts were recorded on a different laptop from the enrollment, so device changes "
            "are part of these numbers."
        )
    summary["limitations"] += [
        "Evaluation enrolls each person on one session; the product requires two, so live checks have more enrollment data.",
        "Sessions were recorded on the same day. Published work shows accuracy drops when weeks pass between sessions.",
        "Thresholds come from held-out scores but are applied to a model refitted on everyone.",
    ]

    verifier = CANDIDATES[chosen][1](rounds)
    version = time.strftime(f"{chosen}-%Y%m%d-%H%M%S")
    summary["version"] = version
    return Model(version, verifier, reject_at, accept_at, source, summary), summary
