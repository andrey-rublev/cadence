"""How a verifier is evaluated: participant-held-out scores, the product policy replayed on
them, and participant-bootstrap confidence intervals (PLAN.md sections 2.4 and 8).

Held-out scores. Every score comes from a model that never saw the people involved:
- up to PAIR_HOLDOUT_MAX_PEOPLE people: for a genuine score the target is held out; for an
  impostor score both the target and the impostor are held out (one fit per pair);
- above that: FOLDS participant-grouped folds, scoring targets against people in their fold.
Each target enrolls on their first session; their later sessions are genuine probes.

Thresholds are nested: the thresholds applied to a target's attempts are chosen from the
other targets' attempts, so no attempt is judged by thresholds tuned on itself.

Intervals resample participants, not attempts, because one person's attempts are not
independent (ISO/IEC 19795-1 Annex B). A person drawn twice counts twice, as a target
and as an impostor.
"""

import hashlib
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from .data import Round, Verifier, sessions_by_person
from .metrics import auc, choose_thresholds, equal_error_rate

PAIR_HOLDOUT_MAX_PEOPLE = 16
FOLDS = 5
POLICY_ROUNDS = 3  # the product asks for at most this many rounds per check (settings.verify_max_rounds)
TARGET_ERROR = 0.05

Fit = Callable[[list[Round]], Verifier]


@dataclass
class Attempt:
    target: str  # the enrolled person
    claimant: str  # who actually produced the probe
    score: float
    session: str
    at: float
    same_station: bool  # probe recorded on the station the enrollment came from

    @property
    def genuine(self) -> bool:
        return self.target == self.claimant


@dataclass
class Decision:
    target: str
    claimant: str
    outcome: str  # "accept" | "reject" | "fallback"
    rounds: int

    @property
    def genuine(self) -> bool:
        return self.target == self.claimant


def _without(rounds: list[Round], people: set[str]) -> list[Round]:
    return [r for r in rounds if r.participant not in people]


def cross_validate(rounds: list[Round], fit: Fit, seed: int = 0) -> tuple[list[Attempt], str]:
    """(held-out attempts, protocol name). Raises whatever `fit` raises."""
    people = sessions_by_person(rounds)
    targets = [p for p, sessions in people.items() if len(sessions) >= 2]
    attempts: list[Attempt] = []

    def score(verifier: Verifier, target: str, claimants: list[str]) -> None:
        enrollment = people[target][0]
        template = np.array([r.vector for r in enrollment])
        for claimant in claimants:
            probes = [
                r
                for index, session in enumerate(people[claimant])
                if not (claimant == target and index == 0)  # skip the enrollment session itself
                for r in session
            ]
            if not probes:
                continue
            scores = verifier.score_many(template, np.array([r.vector for r in probes]))
            attempts.extend(
                Attempt(target, claimant, float(s), r.session, r.at, r.station == enrollment[0].station)
                for r, s in zip(probes, scores)
            )

    if len(people) <= PAIR_HOLDOUT_MAX_PEOPLE:
        protocol = "leave-pair-out"
        for target in targets:
            score(fit(_without(rounds, {target})), target, [target])
            for other in people:
                if other != target:
                    score(fit(_without(rounds, {target, other})), target, [other])
    else:
        protocol = f"{FOLDS}-fold"
        order = sorted(people, key=lambda name: hashlib.sha256(f"{seed}:{name}".encode()).hexdigest())
        for k in range(FOLDS):
            fold = set(order[k::FOLDS])
            verifier = fit(_without(rounds, fold))
            for target in sorted(fold.intersection(targets)):
                score(verifier, target, sorted(fold))
    return [a for a in attempts if np.isfinite(a.score)], protocol


def _split(attempts: list[Attempt]) -> tuple[np.ndarray, np.ndarray]:
    genuine = np.array([a.score for a in attempts if a.genuine])
    impostor = np.array([a.score for a in attempts if not a.genuine])
    return genuine, impostor


def nested_thresholds(attempts: list[Attempt], target_error: float = TARGET_ERROR) -> dict[str, tuple[float, float]]:
    """target -> (reject_at, accept_at) chosen without any attempt that involves that target."""
    names = sorted({x for a in attempts for x in (a.target, a.claimant)})
    index = {name: i for i, name in enumerate(names)}
    targets = np.array([index[a.target] for a in attempts])
    claimants = np.array([index[a.claimant] for a in attempts])
    scores = np.array([a.score for a in attempts])
    genuine_mask = targets == claimants
    thresholds = {}
    for target in {a.target for a in attempts}:
        keep = (targets != index[target]) & (claimants != index[target])
        genuine, impostor = scores[keep & genuine_mask], scores[keep & ~genuine_mask]
        if genuine.size and impostor.size:
            thresholds[target] = choose_thresholds(genuine, impostor, target_error)
    return thresholds


def _sequences(attempts: list[Attempt], length: int) -> list[list[Attempt]]:
    """Consecutive runs of `length` probe rounds from one claimant's session against one target."""
    grouped: dict[tuple[str, str, str], list[Attempt]] = defaultdict(list)
    for a in attempts:
        grouped[(a.target, a.claimant, a.session)].append(a)
    runs = []
    for group in grouped.values():
        group.sort(key=lambda a: a.at)
        runs += [group[i : i + length] for i in range(0, len(group), length)]
    return runs


def replay_policy(attempts: list[Attempt], thresholds: dict[str, tuple[float, float]], rounds: int = POLICY_ROUNDS) -> list[Decision]:
    """What the product would have decided: after each round the mean score so far is compared
    with the thresholds; accept or reject ends the check, and still uncertain after the last
    round sends the person to the trusted fallback."""
    decisions = []
    for run in _sequences(attempts, rounds):
        target, claimant = run[0].target, run[0].claimant
        if target not in thresholds:
            continue
        reject_at, accept_at = thresholds[target]
        outcome, used = "fallback", len(run)
        for i in range(1, len(run) + 1):
            mean = float(np.mean([a.score for a in run[:i]]))
            if mean > accept_at or mean < reject_at:
                outcome, used = ("accept" if mean > accept_at else "reject"), i
                break
        decisions.append(Decision(target, claimant, outcome, used))
    return decisions


def _number(value: float) -> float | None:
    """JSON-safe: NaN and infinity become null rather than invalid JSON."""
    return round(float(value), 4) if np.isfinite(value) else None


def _interval(value: float, draws: np.ndarray) -> dict:
    finite = draws[np.isfinite(draws)]
    low, high = (np.percentile(finite, [2.5, 97.5]) if finite.size else (np.nan, np.nan))
    return {"value": _number(value), "low": _number(low), "high": _number(high)}


class _Weights:
    """Per-attempt weights for one bootstrap draw of participants."""

    def __init__(self, names: list[str], items: list[Attempt] | list[Decision]):
        index = {name: i for i, name in enumerate(names)}
        self.target = np.array([index[x.target] for x in items], dtype=int)
        self.claimant = np.array([index[x.claimant] for x in items], dtype=int)
        self.genuine = np.array([x.genuine for x in items], dtype=bool)

    def of(self, counts: np.ndarray) -> np.ndarray:
        return counts[self.target] * np.where(self.genuine, 1, counts[self.claimant])


def _rate(mask: np.ndarray, weights: np.ndarray) -> float:
    total = weights.sum()
    return float((weights * mask).sum() / total) if total else float("nan")


def evaluate(
    attempts_by_model: dict[str, list[Attempt]],
    reps: int = 1000,
    seed: int = 0,
) -> dict[str, dict]:
    """Per-model metrics with 95% participant-bootstrap intervals. Draws are shared across
    models, so the differences between models are paired."""
    names = sorted({x for atts in attempts_by_model.values() for a in atts for x in (a.target, a.claimant)})
    rng = np.random.default_rng(seed)
    draws = [np.bincount(rng.integers(0, len(names), len(names)), minlength=len(names)) for _ in range(reps)]
    ones = np.ones(len(names), dtype=int)

    report: dict[str, dict] = {}
    auc_draws: dict[str, np.ndarray] = {}
    for model_id, attempts in attempts_by_model.items():
        thresholds = nested_thresholds(attempts)
        decisions = replay_policy(attempts, thresholds)
        triples = [
            Attempt(run[0].target, run[0].claimant, float(np.mean([a.score for a in run])), run[0].session, run[0].at, run[0].same_station)
            for run in _sequences(attempts, POLICY_ROUNDS)
            if len(run) == POLICY_ROUNDS
        ]

        score_sets = {"one": attempts, "three": triples}
        prepared = {}
        for key, items in score_sets.items():
            genuine_mask = np.array([a.genuine for a in items], dtype=bool)
            scores = np.array([a.score for a in items])
            prepared[key] = (scores[genuine_mask], scores[~genuine_mask], _Weights(names, items), genuine_mask)
        d_weights = _Weights(names, decisions)
        outcome = np.array([d.outcome for d in decisions])
        d_genuine = np.array([d.genuine for d in decisions], dtype=bool)

        def stats(counts: np.ndarray) -> dict[str, float]:
            out = {}
            for key, (gen, imp, weights, mask) in prepared.items():
                w = weights.of(counts)
                out[f"auc_{key}"] = auc(gen, imp, w[mask], w[~mask]) if w[mask].sum() and w[~mask].sum() else np.nan
                out[f"eer_{key}"] = equal_error_rate(gen, imp, w[mask], w[~mask]) if w[mask].sum() and w[~mask].sum() else np.nan
            w = d_weights.of(counts)
            g, i = w * d_genuine, w * ~d_genuine
            out["impostor_accepted"] = _rate(outcome == "accept", i)
            out["impostor_fallback"] = _rate(outcome == "fallback", i)
            out["genuine_accepted"] = _rate(outcome == "accept", g)
            out["genuine_rejected"] = _rate(outcome == "reject", g)
            out["genuine_fallback"] = _rate(outcome == "fallback", g)
            return out

        point = stats(ones)
        per_draw = [stats(c) for c in draws]
        samples = {k: np.array([s[k] for s in per_draw]) for k in point}
        auc_draws[model_id] = samples["auc_one"]

        genuine_attempts = [a for a in attempts if a.genuine]
        impostor_attempts = [a for a in attempts if not a.genuine]
        same = [a for a in impostor_attempts if a.same_station]
        other = [a for a in impostor_attempts if not a.same_station]
        g_scores = np.array([a.score for a in genuine_attempts])
        rounds_used = [d.rounds for d in decisions if d.genuine]

        report[model_id] = {
            "counts": {
                "targets": len({a.target for a in attempts}),
                "people": len({x for a in attempts for x in (a.target, a.claimant)}),
                "genuine_attempts": len(genuine_attempts),
                "impostor_attempts": len(impostor_attempts),
                "genuine_same_station": sum(a.same_station for a in genuine_attempts),
                "genuine_decisions": int(d_genuine.sum()),
                "impostor_decisions": int((~d_genuine).sum()),
            },
            "one_round": {"auc": _interval(point["auc_one"], samples["auc_one"]), "eer": _interval(point["eer_one"], samples["eer_one"])},
            "three_rounds": {"auc": _interval(point["auc_three"], samples["auc_three"]), "eer": _interval(point["eer_three"], samples["eer_three"])},
            "policy": {
                k: _interval(point[k], samples[k])
                for k in ("impostor_accepted", "impostor_fallback", "genuine_accepted", "genuine_rejected", "genuine_fallback")
            }
            | {"mean_rounds_genuine": _number(np.mean(rounds_used)) if rounds_used else None},
            # Impostors recorded on the owner's own station are the harder, device-matched case.
            "stations": {
                "same": {"impostor_attempts": len(same), "auc": _number(auc(g_scores, np.array([a.score for a in same])))},
                "other": {"impostor_attempts": len(other), "auc": _number(auc(g_scores, np.array([a.score for a in other])))},
            },
        }

    if "b0" in auc_draws:
        base = report["b0"]["one_round"]["auc"]["value"]
        for model_id in report:
            if model_id != "b0" and base is not None and report[model_id]["one_round"]["auc"]["value"] is not None:
                report[model_id]["auc_gain_over_b0"] = _interval(
                    report[model_id]["one_round"]["auc"]["value"] - base, auc_draws[model_id] - auc_draws["b0"]
                )
    return report


def select(report: dict[str, dict]) -> tuple[str, str]:
    """(model id, reason). A learned model replaces B0 only when its paired AUC gain is clearly above zero."""
    if "b0" not in report:
        best = max(report, key=lambda m: report[m]["one_round"]["auc"]["value"] or -1)
        return best, "B0 was not evaluated; highest held-out AUC."
    winners = [m for m in report if m != "b0" and (report[m].get("auc_gain_over_b0") or {}).get("low") is not None and report[m]["auc_gain_over_b0"]["low"] > 0]
    if not winners:
        return "b0", "No learned model beat B0 by a margin the 95% interval supports, so the simpler baseline stays."
    best = max(winners, key=lambda m: report[m]["one_round"]["auc"]["value"])
    return best, "Its paired AUC gain over B0 has a 95% interval above zero."
