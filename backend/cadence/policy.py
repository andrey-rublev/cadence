"""Decision policy for protected actions.

Four outcomes, kept deliberately distinct:
  CONSISTENT             behaviour matches the owner's profile; continue under existing authentication
  UNCERTAIN              collect another round, or offer the trusted fallback
  INCONSISTENT           hold the action; trusted verification required
  INSUFFICIENT_EVIDENCE  nothing to judge with (no profile, no model, no usable round); never approve

"Too little evidence" is never reported as a mismatch, and a score is never a probability.
"""

from dataclasses import asdict, dataclass

import numpy as np

from .core.config import settings
from .verifier.artifact import Model

CONSISTENT = "CONSISTENT"
UNCERTAIN = "UNCERTAIN"
INCONSISTENT = "INCONSISTENT"
INSUFFICIENT = "INSUFFICIENT_EVIDENCE"


@dataclass
class Decision:
    outcome: str
    reason: str | None = None
    score: float | None = None
    reject_at: float | None = None
    accept_at: float | None = None
    rounds: int = 0
    enrollment_rounds: int = 0
    model_version: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def profile_sufficient(sessions: int, rounds: int) -> bool:
    return sessions >= settings.enroll_min_sessions and rounds >= settings.enroll_min_rounds


def decide(
    model: Model | None,
    enrollment: np.ndarray,
    enrollment_sessions: int,
    probes: list[np.ndarray],
) -> Decision:
    base = Decision(INSUFFICIENT, rounds=len(probes), enrollment_rounds=len(enrollment))
    if model is None:
        base.reason = "model_missing"
        return base
    base.model_version, base.reject_at, base.accept_at = model.version, model.reject_at, model.accept_at
    if not profile_sufficient(enrollment_sessions, len(enrollment)):
        base.reason = "not_enrolled"
        return base
    if not probes:
        base.reason = "no_interaction_yet"
        return base

    scores = [model.verifier.score(enrollment, probe) for probe in probes]
    scores = [s for s in scores if np.isfinite(s)]
    if not scores:
        base.reason = "round_not_measurable"
        return base

    # Evidence accumulates across rounds: the decision uses the mean score so far.
    base.score = float(np.mean(scores))
    if base.score > model.accept_at:
        base.outcome = CONSISTENT
    elif base.score < model.reject_at:
        base.outcome = INCONSISTENT
    else:
        base.outcome = UNCERTAIN
    return base
