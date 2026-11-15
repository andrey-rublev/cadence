"""Evaluation discipline: nothing scored was seen in training, thresholds are nested,
the policy replay matches the product, and the summary is valid JSON."""

import json

import numpy as np
import pytest

from cadence.verifier.data import Round
from cadence.verifier.evaluation import Attempt, cross_validate, nested_thresholds, replay_policy
from cadence.verifier.metrics import auc, equal_error_rate
from cadence.verifier.pairwise import NotTrainable, fit_pairwise
from cadence.verifier.training import synthetic_rounds, train


def people_rounds(people: int, sessions: int = 2, per_session: int = 4) -> list[Round]:
    """Rounds whose first value is the person's index, so a fake verifier can see whose they are."""
    rng = np.random.default_rng(0)
    rounds = []
    for p in range(people):
        for s in range(sessions):
            for i in range(per_session):
                vector = np.concatenate([[p], rng.normal(p, 1, 41)])
                rounds.append(Round(f"p{p}", "train", f"{p}:{s}", s * 100 + i, vector, f"station{p % 2}"))
    return rounds


class Spy:
    """A verifier that fails if it is ever asked to score someone it was trained on."""

    def __init__(self, rounds: list[Round]):
        self.seen = {int(r.vector[0]) for r in rounds}

    def score_many(self, enrollment, probes):
        assert not self.seen & {int(enrollment[0, 0])}, "enrollment person was in training"
        assert not self.seen & {int(v) for v in probes[:, 0]}, "probe person was in training"
        return -np.abs(probes[:, 1] - enrollment[:, 1].mean())


@pytest.mark.parametrize("people", [6, 20])  # leave-pair-out, then grouped folds
def test_no_scored_person_is_in_training(people):
    attempts, protocol = cross_validate(people_rounds(people), Spy)
    assert protocol == ("leave-pair-out" if people <= 16 else "5-fold")
    assert any(a.genuine for a in attempts) and any(not a.genuine for a in attempts)
    # The enrollment session is never also a genuine probe.
    assert all(a.session != f"{a.target[1:]}:0" for a in attempts if a.genuine)


def test_weighted_metrics_match_duplication():
    rng = np.random.default_rng(1)
    genuine, impostor = rng.normal(1, 1, 30), rng.normal(0, 1, 80)
    weights = rng.integers(0, 3, 30).astype(float)
    doubled = np.repeat(genuine, weights.astype(int))
    assert auc(genuine, impostor, weights, None) == pytest.approx(auc(doubled, impostor))
    assert equal_error_rate(genuine, impostor, weights, None) == pytest.approx(equal_error_rate(doubled, impostor))
    assert auc(genuine, impostor, np.ones(30), np.ones(80)) == pytest.approx(auc(genuine, impostor))


def attempt(target, claimant, score, session="s", at=0.0):
    return Attempt(target, claimant, score, session, at, False)


def test_thresholds_for_a_person_ignore_that_persons_attempts():
    base = [attempt(t, t, 1.0 + i / 10, at=i) for t in "abc" for i in range(5)]
    base += [attempt(t, o, -1.0 - i / 10, at=i) for t in "abc" for o in "abc" if o != t for i in range(5)]
    before = nested_thresholds(base)["a"]
    shifted = [attempt(a.target, a.claimant, a.score * 50, a.session, a.at) if "a" in (a.target, a.claimant) else a for a in base]
    assert nested_thresholds(shifted)["a"] == before


def test_policy_replay_matches_the_product_rule():
    thresholds = {"a": (-1.0, 1.0)}
    # mean after round 1 is 0 (uncertain), after round 2 is 1.5 (> 1): accepted on round 2
    accepted = replay_policy([attempt("a", "a", 0.0, at=0), attempt("a", "a", 3.0, at=1), attempt("a", "a", 9, at=2)], thresholds)
    assert [(d.outcome, d.rounds) for d in accepted] == [("accept", 2)]
    rejected = replay_policy([attempt("a", "b", -2.0, at=0)], thresholds)
    assert [(d.outcome, d.rounds) for d in rejected] == [("reject", 1)]
    unresolved = replay_policy([attempt("a", "a", 0.5, at=i) for i in range(3)], thresholds)
    assert [(d.outcome, d.rounds) for d in unresolved] == [("fallback", 3)]


def test_pairwise_needs_someone_with_two_sessions():
    with pytest.raises(NotTrainable):
        fit_pairwise(people_rounds(4, sessions=1), "logistic")


def test_training_summary_compares_models_and_is_strict_json():
    model, summary = train(synthetic_rounds(12, seed=5), "synthetic", reps=50)
    assert model is not None
    assert [m["id"] for m in summary["models"]] == ["b0", "m1", "m2"]
    assert summary["selected"]["id"] in {"b0", "m1", "m2"}
    assert summary["thresholds"]["reject_at"] <= summary["thresholds"]["accept_at"]
    for entry in summary["models"]:
        interval = entry["one_round"]["auc"]
        assert interval["low"] <= interval["value"] <= interval["high"]
    json.dumps(summary, allow_nan=False)  # the browser rejects NaN in JSON
    assert any("synthetic" in line for line in summary["limitations"])


def test_too_little_data_activates_nothing():
    model, summary = train(synthetic_rounds(4, seed=5), "synthetic", candidates=("b0",), reps=20)
    assert model is None
    assert any("No model was activated" in line for line in summary["limitations"])
