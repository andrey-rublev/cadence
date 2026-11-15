"""Verification metrics. All take similarity scores where higher means "more like the owner".

The optional weights let the participant bootstrap reuse these functions: a person drawn
twice counts twice. Without weights every attempt counts once.
"""

import numpy as np


def _weights(values: np.ndarray, weights: np.ndarray | None) -> np.ndarray:
    return np.ones(len(values)) if weights is None else np.asarray(weights, dtype=float)


def far(impostor: np.ndarray, accept_at: float) -> float:
    """False acceptance rate: share of impostor attempts scoring above the accept threshold."""
    return float((impostor > accept_at).mean()) if impostor.size else float("nan")


def frr(genuine: np.ndarray, reject_at: float) -> float:
    """False rejection rate: share of genuine attempts scoring below the reject threshold."""
    return float((genuine < reject_at).mean()) if genuine.size else float("nan")


def error_curve(
    genuine: np.ndarray,
    impostor: np.ndarray,
    genuine_weights: np.ndarray | None = None,
    impostor_weights: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(cuts, far, frr) at every distinct score, accepting scores at or above the cut."""
    gw, iw = _weights(genuine, genuine_weights), _weights(impostor, impostor_weights)
    cuts = np.unique(np.concatenate([genuine, impostor]))
    go, io = np.argsort(genuine, kind="stable"), np.argsort(impostor, kind="stable")
    g_cum = np.concatenate([[0.0], np.cumsum(gw[go])])
    i_cum = np.concatenate([[0.0], np.cumsum(iw[io])])
    rejected = g_cum[np.searchsorted(genuine[go], cuts, "left")] / g_cum[-1]
    accepted = 1 - i_cum[np.searchsorted(impostor[io], cuts, "left")] / i_cum[-1]
    return cuts, accepted, rejected


def equal_error_rate(
    genuine: np.ndarray,
    impostor: np.ndarray,
    genuine_weights: np.ndarray | None = None,
    impostor_weights: np.ndarray | None = None,
) -> float:
    if not genuine.size or not impostor.size:
        return float("nan")
    _, accepted, rejected = error_curve(genuine, impostor, genuine_weights, impostor_weights)
    k = int(np.argmin(np.abs(accepted - rejected)))
    return float((accepted[k] + rejected[k]) / 2)


def auc(
    genuine: np.ndarray,
    impostor: np.ndarray,
    genuine_weights: np.ndarray | None = None,
    impostor_weights: np.ndarray | None = None,
) -> float:
    """Probability that a random genuine attempt outscores a random impostor attempt."""
    if not genuine.size or not impostor.size:
        return float("nan")
    gw, iw = _weights(genuine, genuine_weights), _weights(impostor, impostor_weights)
    io = np.argsort(impostor, kind="stable")
    ranked = impostor[io]
    i_cum = np.concatenate([[0.0], np.cumsum(iw[io])])
    below = i_cum[np.searchsorted(ranked, genuine, "left")]
    tied = i_cum[np.searchsorted(ranked, genuine, "right")] - below
    return float((gw * (below + tied / 2)).sum() / (gw.sum() * iw.sum()))


def choose_thresholds(genuine: np.ndarray, impostor: np.ndarray, target: float = 0.05) -> tuple[float, float]:
    """(reject_at, accept_at) from held-out scores.

    accept_at is the lowest score that keeps FAR at or under `target`;
    reject_at is the highest score that keeps FRR at or under `target`.
    Scores between them are UNCERTAIN. If the two groups separate cleanly the zone
    collapses to a single cut between them.
    """
    accept_at = float(np.quantile(impostor, 1 - target, method="higher"))
    reject_at = float(np.quantile(genuine, target, method="lower"))
    if reject_at >= accept_at:
        reject_at = accept_at = (reject_at + accept_at) / 2
    return reject_at, accept_at
