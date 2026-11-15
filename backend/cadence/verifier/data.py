"""Scored rounds as the model lane sees them, and how they group into people and sessions."""

from collections import defaultdict
from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass
class Round:
    participant: str
    split: str
    session: str
    at: float
    vector: np.ndarray
    # The laptop and pointing device the round was recorded on. Evaluation metadata only:
    # never a model input, or the model would learn the device instead of the person.
    station: str = ""


class Verifier(Protocol):
    def score(self, enrollment: np.ndarray, probe: np.ndarray) -> float:
        """Similarity of one probe round to an enrollment (higher = more like the owner). Not a probability."""
        ...

    def score_many(self, enrollment: np.ndarray, probes: np.ndarray) -> np.ndarray:
        """`score` for each row of `probes`."""
        ...


def sessions_by_person(rounds: list[Round]) -> dict[str, list[list[Round]]]:
    """participant -> their sessions in the order they were recorded, each session's rounds in order."""
    grouped: dict[str, dict[str, list[Round]]] = defaultdict(lambda: defaultdict(list))
    for r in rounds:
        grouped[r.participant][r.session].append(r)
    return {
        person: sorted(
            (sorted(rs, key=lambda r: r.at) for rs in sessions.values()),
            key=lambda rs: rs[0].at,
        )
        for person, sessions in grouped.items()
    }
