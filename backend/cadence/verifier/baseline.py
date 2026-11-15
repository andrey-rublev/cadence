"""B0: the distance baseline every other model must beat.

Scaled Manhattan distance between a probe round and an account's enrollment template.
The score is a similarity (higher = more like the enrolled owner). It is not a
probability of identity and must never be shown as one.
"""

from dataclasses import dataclass

import numpy as np


@dataclass
class Baseline:
    """Per-feature centre and spread, fitted on training participants only."""

    center: np.ndarray
    scale: np.ndarray

    @classmethod
    def fit(cls, train: np.ndarray) -> "Baseline":
        center = np.nanmedian(train, axis=0)
        q75, q25 = np.nanpercentile(train, [75, 25], axis=0)
        scale = q75 - q25
        # A feature with no spread carries no information; an infinite scale zeroes it out.
        scale = np.where(np.isfinite(scale) & (scale > 1e-9), scale, np.inf)
        return cls(center=np.nan_to_num(center), scale=scale)

    def _z(self, x: np.ndarray) -> np.ndarray:
        return np.clip((x - self.center) / self.scale, -6, 6)

    def score(self, enrollment: np.ndarray, probe: np.ndarray) -> float:
        """Similarity of one probe round to the template built from `enrollment` rounds."""
        return float(self.score_many(enrollment, np.atleast_2d(probe))[0])

    def score_many(self, enrollment: np.ndarray, probes: np.ndarray) -> np.ndarray:
        template = np.nanmedian(self._z(enrollment), axis=0)
        distance = np.abs(self._z(probes) - template)
        usable = np.isfinite(distance) & np.isfinite(self.scale)
        total = np.where(usable, distance, 0.0).sum(axis=1)
        count = usable.sum(axis=1)
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(count > 0, -total / count, np.nan)
