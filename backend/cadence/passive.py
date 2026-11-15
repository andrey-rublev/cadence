"""Passive verification: no challenge, no game.

While a consenting user works in the app, the SDK sends windows of ordinary pointer
movement (12 strokes) and key timing (50 presses). During a trusted session (just after
the demo authenticator) windows build the enrollment profile; otherwise they are evidence
for the current session. A protected action is decided from recent evidence:

- each modality with a model and a sufficient profile is scored separately (mean of its
  latest windows against its own thresholds);
- any modality that looks INCONSISTENT holds the action;
- otherwise any CONSISTENT modality releases it;
- otherwise it is UNCERTAIN, and with no usable evidence it is INSUFFICIENT_EVIDENCE.

The client controls what it sends, so passive evidence can be scripted by an attacker who
controls the browser. It is a risk signal; the trusted fallback is always available.
"""

import json
from dataclasses import asdict, dataclass, field

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .core.config import settings
from .core.models import PassiveWindow, UserSession, now
from .features.keys import KEY_FEATURE_NAMES, KEY_SCHEMA
from .features.strokes import K_FEATURE_NAMES, K_SCHEMA
from .policy import CONSISTENT, INCONSISTENT, INSUFFICIENT, UNCERTAIN
from .product import is_trusted
from .verifier.artifact import Model, load_active

MODALITIES = {
    "pointer": {"names": K_FEATURE_NAMES, "schema": K_SCHEMA},
    "keys": {"names": KEY_FEATURE_NAMES, "schema": KEY_SCHEMA},
}


def passive_model(modality: str) -> Model | None:
    spec = MODALITIES[modality]
    return load_active(settings.artifacts_dir / modality, spec["names"], spec["schema"])


def _vectors(db: Session, account_id: int, modality: str, purpose: str, **where) -> list[tuple[np.ndarray, int, float]]:
    query = select(PassiveWindow.values_json, PassiveWindow.session_id, PassiveWindow.captured_at).where(
        PassiveWindow.account_id == account_id,
        PassiveWindow.modality == modality,
        PassiveWindow.purpose == purpose,
        PassiveWindow.feature_schema == MODALITIES[modality]["schema"],
    )
    if "session_id" in where:
        query = query.where(PassiveWindow.session_id == where["session_id"])
    if "since" in where:
        query = query.where(PassiveWindow.captured_at >= where["since"])
    rows = db.execute(query.order_by(PassiveWindow.captured_at)).all()
    return [(np.array(json.loads(v), dtype=float), s, t) for v, s, t in rows]


def passive_profile(db: Session, account_id: int, session: UserSession) -> dict:
    """Per modality: enrollment windows and sign-ins so far, and evidence in this session."""
    out = {}
    for modality in MODALITIES:
        enrolled = _vectors(db, account_id, modality, "enroll")
        sessions = len({s for _, s, _ in enrolled})
        evidence = db.scalar(
            select(func.count()).where(
                PassiveWindow.session_id == session.id,
                PassiveWindow.modality == modality,
                PassiveWindow.purpose == "evidence",
                PassiveWindow.captured_at >= now() - settings.passive_evidence_ttl_s,
            )
        )
        out[modality] = {
            "windows": len(enrolled),
            "sessions": sessions,
            "windows_needed": settings.passive_min_windows,
            "sessions_needed": settings.passive_min_sessions,
            "sufficient": len(enrolled) >= settings.passive_min_windows and sessions >= settings.passive_min_sessions,
            "recent_evidence": int(evidence or 0),
            "model": None if (m := passive_model(modality)) is None else {"version": m.version, "source": m.source},
        }
    return out


@dataclass
class Part:
    modality: str
    outcome: str
    reason: str | None = None
    score: float | None = None
    reject_at: float | None = None
    accept_at: float | None = None
    windows: int = 0
    enrollment_windows: int = 0
    model_version: str | None = None


@dataclass
class PassiveDecision:
    outcome: str
    reason: str | None = None
    parts: list[Part] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _decide_part(db: Session, account_id: int, session: UserSession, modality: str) -> Part:
    part = Part(modality, INSUFFICIENT)
    model = passive_model(modality)
    if model is None:
        part.reason = "model_missing"
        return part
    part.model_version, part.reject_at, part.accept_at = model.version, model.reject_at, model.accept_at
    enrolled = _vectors(db, account_id, modality, "enroll")
    part.enrollment_windows = len(enrolled)
    if not (len(enrolled) >= settings.passive_min_windows and len({s for _, s, _ in enrolled}) >= settings.passive_min_sessions):
        part.reason = "not_enrolled"
        return part
    evidence = _vectors(
        db, account_id, modality, "evidence", session_id=session.id, since=now() - settings.passive_evidence_ttl_s
    )[-settings.passive_evidence_windows :]
    part.windows = len(evidence)
    if not evidence:
        part.reason = "no_interaction_yet"
        return part
    enrollment = np.array([v for v, _, _ in enrolled])
    scores = model.verifier.score_many(enrollment, np.array([v for v, _, _ in evidence]))
    scores = scores[np.isfinite(scores)]
    if not scores.size:
        part.reason = "window_not_measurable"
        return part
    part.score = float(scores.mean())
    part.outcome = CONSISTENT if part.score > model.accept_at else INCONSISTENT if part.score < model.reject_at else UNCERTAIN
    return part


def decide_passive(db: Session, account_id: int, session: UserSession) -> PassiveDecision:
    parts = [_decide_part(db, account_id, session, modality) for modality in MODALITIES]
    if is_trusted(session):
        # A learning sign-in: its windows go into the profile, so there is no evidence to
        # compare, and comparing a sitting with itself would flatter the score anyway.
        return PassiveDecision(INSUFFICIENT, reason="learning_session", parts=parts)
    outcomes = {p.outcome for p in parts}
    if INCONSISTENT in outcomes:
        return PassiveDecision(INCONSISTENT, parts=parts)
    if CONSISTENT in outcomes:
        return PassiveDecision(CONSISTENT, parts=parts)
    if UNCERTAIN in outcomes:
        return PassiveDecision(UNCERTAIN, parts=parts)
    reasons = {p.reason for p in parts}
    # The most useful thing to tell the user: what would let a check happen.
    for reason in ("no_interaction_yet", "not_enrolled", "model_missing", "window_not_measurable"):
        if reason in reasons:
            return PassiveDecision(INSUFFICIENT, reason=reason, parts=parts)
    return PassiveDecision(INSUFFICIENT, reason="no_evidence", parts=parts)
