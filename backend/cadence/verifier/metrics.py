"""Verification metrics. All take similarity scores where higher means "more like the owner"."""

import numpy as np


def far(impostor: np.ndarray, accept_at: float) -> float:
    """False acceptance rate: share of impostor attempts scoring above the accept threshold."""
    return float((impostor > accept_at).mean()) if impostor.size else float("nan")


def frr(genuine: np.ndarray, reject_at: float) -> float:
    """False rejection rate: share of genuine attempts scoring below the reject threshold."""
    return float((genuine < reject_at).mean()) if genuine.size else float("nan")


def equal_error_rate(genuine: np.ndarray, impostor: np.ndarray) -> float:
    if not genuine.size or not impostor.size:
        return float("nan")
    cuts = np.unique(np.concatenate([genuine, impostor]))
    gaps = [(abs((impostor >= c).mean() - (genuine < c).mean()), c) for c in cuts]
    cut = min(gaps)[1]
    return float(((impostor >= cut).mean() + (genuine < cut).mean()) / 2)


def auc(genuine: np.ndarray, impostor: np.ndarray) -> float:
    """Probability that a random genuine attempt outscores a random impostor attempt."""
    if not genuine.size or not impostor.size:
        return float("nan")
    wins = (genuine[:, None] > impostor[None, :]).mean()
    ties = (genuine[:, None] == impostor[None, :]).mean()
    return float(wins + ties / 2)


def choose_thresholds(genuine: np.ndarray, impostor: np.ndarray, target: float = 0.05) -> tuple[float, float]:
    """(reject_at, accept_at) from validation scores.

    accept_at is the lowest score that keeps validation FAR at or under `target`;
    reject_at is the highest score that keeps validation FRR at or under `target`.
    Scores between them are UNCERTAIN. If the two groups separate cleanly the zone
    collapses to a single cut between them.
    """
    accept_at = float(np.quantile(impostor, 1 - target, method="higher"))
    reject_at = float(np.quantile(genuine, target, method="lower"))
    if reject_at >= accept_at:
        reject_at = accept_at = (reject_at + accept_at) / 2
    return reject_at, accept_at
