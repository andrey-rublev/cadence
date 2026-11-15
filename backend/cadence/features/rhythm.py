"""Password rhythm: how one person types the same secret, key by key.

A sign-in repeats the same email and password every time, so the presses inside the password
field line up one to one between sign-ins. The general keyboard models cannot use that: they
summarise timing by keyboard zone, and a password field sends no zones. Here the presses are
compared position by position instead (the hold of the 1st key, the gap from the 1st to the
2nd, and so on), which is how fixed-text keystroke dynamics is usually done (Killourhy and
Maxion, DSN 2009).

Only timing is used. The browser marks presses in secret fields as SECRET, without zone or
character, so the vector says how the password was typed, not what it is. Its length is the
number of presses, which the evidence stream already reveals.

A rhythm vector for n presses is [hold_1..hold_n, down-down_1..n-1] in ms. Up-down gaps are
left out: they follow from the other two, and on the CMU benchmark leaving them out was more
accurate (artifacts/reports/cmu-rhythm.json).
"""

import math

import numpy as np

from .keys import SECRET

RHYTHM_SCHEMA = 1
MIN_PRESSES = 6  # below this a password says too little to compare
MAX_PRESSES = 64
RUN_GAP_MS = 3000  # a pause this long inside the field starts a new attempt


def secret_run(presses: list[tuple[float, float, int]]) -> list[tuple[float, float, int]]:
    """The last uninterrupted run of presses in a secret field: the password as finally typed.

    Any press outside the field (typing the email, pressing Enter or Tab) or a long pause ends a
    run, so a mistyped first attempt followed by a second one gives only the second.
    """
    runs: list[list[tuple[float, float, int]]] = []
    current: list[tuple[float, float, int]] = []
    for p in sorted(presses):
        if p[2] != SECRET:
            if current:
                runs.append(current)
                current = []
            continue
        if current and p[0] - current[-1][0] > RUN_GAP_MS:
            runs.append(current)
            current = []
        current.append(p)
    if current:
        runs.append(current)
    return runs[-1] if runs else []


def rhythm_vector(run: list[tuple[float, float, int]]) -> np.ndarray:
    """[holds, down-down gaps] for presses in down order."""
    run = sorted(run)
    holds = [up - down for down, up, _ in run]
    dd = [b[0] - a[0] for a, b in zip(run, run[1:])]
    return np.array(holds + dd, dtype=float)


def presses_of(vector: np.ndarray | list) -> int:
    """Number of presses a rhythm vector describes (its length is 2n - 1)."""
    return (len(vector) + 1) // 2


class RhythmVerifier:
    """Scaled Manhattan distance to the mean of earlier sign-ins, as a similarity.

    Each feature's distance is divided by its spread across the earlier sign-ins (mean absolute
    deviation), floored so that a feature that happened to match closely in three earlier
    sign-ins does not dominate. The score is minus the mean scaled distance: higher means more
    like the earlier sign-ins, and it is not a probability.

    Thresholds depend on how many presses are compared (more presses, steadier average) and
    on how many earlier sign-ins there are (more of them, a tighter template), so they are kept
    per (earlier sign-ins, presses) as measured; between measured values the next lower one
    is used, and beyond the largest the largest.
    """

    def __init__(
        self, floor_ms: float, floor_share: float, thresholds: dict[int, dict[int, tuple[float, float]]] | None = None
    ):
        self.floor_ms = floor_ms
        self.floor_share = floor_share
        self.thresholds = thresholds or {}

    def score_many(self, templates: np.ndarray, probes: np.ndarray) -> np.ndarray:
        templates, probes = np.atleast_2d(templates), np.atleast_2d(probes)
        if templates.shape[1] != probes.shape[1] or len(templates) < 2:
            return np.full(len(probes), np.nan)
        mean = templates.mean(axis=0)
        spread = np.abs(templates - mean).mean(axis=0)
        spread = np.maximum(spread, self.floor_ms + self.floor_share * np.abs(mean))
        return -(np.abs(probes - mean) / spread).mean(axis=1)

    def score(self, templates: np.ndarray, probe: np.ndarray) -> float:
        return float(self.score_many(templates, probe[None, :])[0])

    def thresholds_for(self, earlier: int, presses: int) -> tuple[float, float] | None:
        """(reject_at, accept_at), or None with fewer earlier sign-ins or presses than measured."""
        counts = [k for k in sorted(self.thresholds) if k <= earlier]
        if not counts:
            return None
        by_presses = self.thresholds[counts[-1]]
        lengths = [n for n in sorted(by_presses) if n <= presses]
        return by_presses[lengths[-1]] if lengths else None


def clean(vector: np.ndarray) -> list[float]:
    return [float(v) if math.isfinite(v) else 0.0 for v in vector.tolist()]
