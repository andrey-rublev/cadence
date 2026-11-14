"""Product-side services: who is signed in, their movement profile, trust and grants."""

import json
import secrets
from typing import Annotated

import numpy as np
from fastapi import Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .core.config import settings
from .core.db import Db
from .core.models import Account, ActionGrant, Sample, SampleFeatures, UserSession, now
from .core.security import CurrentSession
from .features.extract import FEATURE_SCHEMA, to_vector
from .policy import profile_sufficient
from .verifier.artifact import Model, load_active

EXPORT_CUSTOMERS = "export_customers"
PROTECTED_ACTIONS = {EXPORT_CUSTOMERS}


def current_account(session: CurrentSession, db: Db) -> Account:
    account = db.get(Account, session.account_id) if session.kind == "app" and session.account_id else None
    if account is None:
        raise HTTPException(401, "not_signed_in")
    return account


CurrentAccount = Annotated[Account, Depends(current_account)]


def is_trusted(session: UserSession) -> bool:
    """True while a trusted verification done in this session is still fresh."""
    return session.trusted_at is not None and now() - session.trusted_at < settings.trust_ttl_s


def active_model() -> Model | None:
    return load_active()


def enrollment(db: Session, account_id: int) -> tuple[np.ndarray, int]:
    """(feature matrix of scored enrollment rounds, number of sessions they came from)."""
    rows = db.execute(
        select(SampleFeatures.values_json, Sample.session_id)
        .join(Sample, Sample.id == SampleFeatures.sample_id)
        .where(
            Sample.account_id == account_id,
            Sample.purpose == "enroll",
            Sample.is_warmup.is_(False),
            SampleFeatures.feature_schema == FEATURE_SCHEMA,
        )
    ).all()
    vectors = np.array([to_vector(json.loads(values)) for values, _ in rows]) if rows else np.empty((0, 0))
    return vectors, len({session_id for _, session_id in rows})


def profile_status(db: Session, account: Account, session: UserSession) -> dict:
    vectors, sessions = enrollment(db, account.id)
    counts = dict(
        db.execute(
            select(Sample.is_warmup, func.count())
            .where(Sample.session_id == session.id, Sample.purpose == "enroll")
            .group_by(Sample.is_warmup)
        ).all()
    )
    return {
        "sufficient": profile_sufficient(sessions, len(vectors)),
        "sessions": sessions,
        "rounds": len(vectors),
        "sessions_needed": settings.enroll_min_sessions,
        "rounds_needed": settings.enroll_min_rounds,
        # Progress of the enrollment block in this sign-in.
        "this_session": {
            "practice_done": counts.get(True, 0) > 0,
            "rounds": counts.get(False, 0),
            "rounds_total": settings.enroll_rounds_per_session,
        },
    }


def issue_grant(db: Session, session: UserSession, action: str, basis: str) -> ActionGrant:
    """Bind permission for `action` to this session. Caller commits."""
    grant = ActionGrant(
        id=secrets.token_urlsafe(32),
        session_id=session.id,
        account_id=session.account_id,
        action=action,
        basis=basis,
        expires_at=now() + settings.grant_ttl_s,
    )
    db.add(grant)
    return grant


def redeem_grant(db: Session, session: UserSession, grant_id: str, action: str) -> ActionGrant:
    """Consume a grant or raise. The frontend cannot fake this: every check is on stored state."""
    grant = db.get(ActionGrant, grant_id)
    if grant is None or grant.session_id != session.id or grant.action != action:
        raise HTTPException(403, "verification_required")
    if now() > grant.expires_at:
        raise HTTPException(403, "grant_expired")
    claimed = db.execute(
        update(ActionGrant).where(ActionGrant.id == grant_id, ActionGrant.used_at.is_(None)).values(used_at=now())
    )
    db.commit()
    if claimed.rowcount != 1:
        raise HTTPException(403, "grant_already_used")
    return grant
