"""Fit the baseline, choose thresholds on validation participants, report on test participants.

Split discipline (PLAN.md section 8):
- whole participants belong to exactly one of train / validation / test;
- the scaler is fitted on training participants only;
- thresholds come from validation participants only;
- the reported numbers come from test participants, who are unfamiliar to the model.
"""

import json
import random
import sqlite3
import time
import zlib
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..challenges.replay import replay_round
from ..challenges.spec import generate_layout
from ..features.extract import FEATURE_SCHEMA, extract_round, to_vector
from ..synthetic import SyntheticProfile, simulate_round
from .artifact import Model
from .baseline import Baseline
from .metrics import auc, choose_thresholds, equal_error_rate, far, frr

# Below these counts a threshold or an error rate is noise, so none is published.
MIN_VALIDATION_GENUINE = 10
MIN_VALIDATION_IMPOSTOR = 30
MIN_TEST_PARTICIPANTS = 5
MIN_TEST_IMPOSTOR = 30


@dataclass
class Round:
    participant: str
    split: str
    session: str
    at: float
    vector: np.ndarray


def load_volunteer_rounds(databases: list[Path], include_pilots: bool = False) -> list[Round]:
    """Scored volunteer rounds from one or more collection laptops, merged by username."""
    rounds = []
    for index, path in enumerate(databases):
        with sqlite3.connect(path) as db:
            rows = db.execute(
                """
                SELECT p.username, p.split, p.is_pilot, s.session_id, s.captured_at,
                       s.events_z, s.timeline_json, c.layout_json
                FROM samples s
                JOIN participants p ON p.id = s.participant_id
                JOIN challenges c ON c.id = s.challenge_id
                WHERE s.is_warmup = 0 AND s.source = 'volunteer' AND s.events_z IS NOT NULL
                """
            ).fetchall()
        for username, split, is_pilot, session_id, at, events_z, timeline, layout in rows:
            if is_pilot and not include_pilots:
                continue
            features = extract_round(json.loads(layout), json.loads(zlib.decompress(events_z)), json.loads(timeline))
            rounds.append(Round(username, split, f"{index}:{session_id}", at, to_vector(features)))
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
                rounds.append(Round(f"synthetic{person}", split, f"{person}:{session}", session * 100 + index, to_vector(features)))
    return rounds


def _scores(verifier: Baseline, rounds: list[Round]) -> tuple[np.ndarray, np.ndarray, int]:
    """(genuine, impostor, participants with an enrollment) for one split.

    Each participant enrolls on their first session. Their later sessions are genuine
    probes; every round from the other participants in the split is an impostor probe.
    """
    by_person: dict[str, dict[str, list[Round]]] = defaultdict(lambda: defaultdict(list))
    for r in rounds:
        by_person[r.participant][r.session].append(r)
    genuine, impostor, enrolled = [], [], 0
    for person, sessions in by_person.items():
        ordered = sorted(sessions.values(), key=lambda rs: min(r.at for r in rs))
        enrollment = np.array([r.vector for r in ordered[0]])
        enrolled += 1
        genuine += [verifier.score(enrollment, r.vector) for later in ordered[1:] for r in later]
        impostor += [
            verifier.score(enrollment, r.vector)
            for other, other_sessions in by_person.items()
            if other != person
            for rs in other_sessions.values()
            for r in rs
        ]
    clean = lambda values: np.array([v for v in values if np.isfinite(v)])  # noqa: E731
    return clean(genuine), clean(impostor), enrolled


def train(rounds: list[Round], source: str) -> tuple[Model | None, dict]:
    """Returns (model, summary). The model is None when the data cannot support thresholds."""
    version = time.strftime("b0-%Y%m%d-%H%M%S")
    by_split: dict[str, list[Round]] = defaultdict(list)
    for r in rounds:
        by_split[r.split].append(r)
    people = {split: len({r.participant for r in rs}) for split, rs in by_split.items()}
    summary: dict = {
        "version": version,
        "model": "B0 scaled Manhattan distance",
        "source": source,
        "feature_schema": FEATURE_SCHEMA,
        "participants": people,
        "rounds": {split: len(rs) for split, rs in by_split.items()},
        "limitations": [],
    }
    if source == "synthetic":
        summary["limitations"].append("Trained on synthetic players. These numbers say nothing about real people.")

    if len(by_split["train"]) < 2:
        summary["limitations"].append("No training participants, so nothing was fitted.")
        return None, summary
    verifier = Baseline.fit(np.array([r.vector for r in by_split["train"]]))

    val_genuine, val_impostor, _ = _scores(verifier, by_split["validation"])
    summary["validation"] = {"genuine_attempts": int(val_genuine.size), "impostor_attempts": int(val_impostor.size)}
    if val_genuine.size < MIN_VALIDATION_GENUINE or val_impostor.size < MIN_VALIDATION_IMPOSTOR:
        summary["limitations"].append(
            f"Too few validation attempts to choose thresholds (need {MIN_VALIDATION_GENUINE} genuine "
            f"and {MIN_VALIDATION_IMPOSTOR} impostor). No model was activated."
        )
        return None, summary
    reject_at, accept_at = choose_thresholds(val_genuine, val_impostor)
    summary["thresholds"] = {"reject_at": reject_at, "accept_at": accept_at, "target_error": 0.05}

    genuine, impostor, enrolled = _scores(verifier, by_split["test"])
    test = {
        "participants": enrolled,
        "genuine_attempts": int(genuine.size),
        "impostor_attempts": int(impostor.size),
        "reliable": enrolled >= MIN_TEST_PARTICIPANTS and impostor.size >= MIN_TEST_IMPOSTOR and genuine.size > 0,
    }
    if genuine.size and impostor.size:
        test |= {
            "far_at_accept": far(impostor, accept_at),
            "frr_at_reject": frr(genuine, reject_at),
            "genuine_uncertain": float(((genuine >= reject_at) & (genuine <= accept_at)).mean()),
            "impostor_uncertain": float(((impostor >= reject_at) & (impostor <= accept_at)).mean()),
            "eer": equal_error_rate(genuine, impostor),
            "auc": auc(genuine, impostor),
        }
    if not test["reliable"]:
        summary["limitations"].append(
            f"Test set is too small for a reliable estimate (need {MIN_TEST_PARTICIPANTS} participants "
            f"and {MIN_TEST_IMPOSTOR} impostor attempts). Treat these numbers as a pipeline check."
        )
    summary["test"] = test
    return Model(version, verifier, reject_at, accept_at, source, summary), summary
