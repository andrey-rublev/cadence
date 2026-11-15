"""Cadence setup on the Cadence site: a short click test and a typing test with given
sentences. Most of what a profile needs is collected here, so partner sites can check people
from whatever they do while signing in. Sign-in typing is taught per site: right after
connecting one, the person types that site's own sign-in a few times (`api/sites.py`).
"""

import json
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .core.config import settings
from .core.models import Account, PassiveWindow, UserSession, now
from .core.security import hash_token
from .passive import MODALITIES, evidence_windows, window_digest
from .product import is_trusted


def _windows(db: Session, account_id: int, modality: str) -> int:
    return int(
        db.scalar(
            select(func.count()).where(
                PassiveWindow.account_id == account_id,
                PassiveWindow.modality == modality,
                PassiveWindow.purpose == "enroll",
            )
        )
        or 0
    )


def setup_status(db: Session, account: Account) -> dict:
    """Progress through setup. Marks the account complete the first time every step is done."""
    clicks = _windows(db, account.id, "pointer")
    typing = _windows(db, account.id, "keys")
    steps = {
        "clicks": {"done": clicks, "needed": settings.setup_pointer_windows},
        "typing": {"done": typing, "needed": settings.setup_key_windows},
    }
    complete = all(s["done"] >= s["needed"] for s in steps.values())
    if complete and account.setup_completed_at is None:
        account.setup_completed_at = now()
        db.commit()
    return {"complete": account.setup_completed_at is not None, "steps": steps}


def learning_open(account: Account, session: UserSession) -> bool:
    """Whether activity on the Cadence site goes into the profile: during setup, or in a
    session that passed trusted verification. Otherwise it is evidence."""
    return account.setup_completed_at is None or is_trusted(session)


def record_sign_in(db: Session, account: Account, session: UserSession, activity: dict | None) -> int:
    """Keep the typing of a Cadence sign-in while setup is open (it counts as a separate
    sign-in for the profile). Returns how many windows were stored. Caller commits."""
    if activity is None or account.consent_at is None or account.setup_completed_at is not None:
        return 0
    stored = 0
    for window in evidence_windows(activity.get("keys") or [], activity.get("pointer") or []):
        purpose = "login" if window["use"] == "login" else "enroll"
        if purpose == "enroll" and window["modality"] == "pointer":
            continue  # a sign-in's few clicks are not a click test
        db.add(
            PassiveWindow(
                session_id=session.id,
                account_id=account.id,
                modality=window["modality"],
                purpose=purpose,
                feature_schema=MODALITIES[window["modality"]]["schema"],
                values_json=json.dumps(window["values"]),
                digest=window_digest(window, f"signin:{session.id}"),
                duration_ms=0,
            )
        )
        stored += 1
    return stored


def site_session(db: Session, account_id: int) -> UserSession:
    """A record standing for one partner sign-in, so verified evidence from it counts as a
    separate sitting in the profile. It can never be used as a cookie session."""
    session = UserSession(
        token_hash=hash_token(secrets.token_urlsafe(32)), kind="site", account_id=account_id, expires_at=now()
    )
    db.add(session)
    db.flush()
    return session
