import hashlib
import hmac
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from ..collect import normalise_username
from ..core.config import settings
from ..core.db import Db
from ..core.models import Account, ActionGrant, PassiveWindow, Sample, SampleFeatures, TrustCode, Verification, now
from ..core.passwords import hash_password, verify_password
from ..core.security import (
    CurrentSession,
    OptionalSession,
    close_session,
    open_session,
    require_client_header,
)
from ..passive import passive_profile
from ..product import CurrentAccount, active_model, is_trusted, issue_grant, profile_status
from ..setup import learning_open, record_sign_in, setup_status
from .passive import Activity, check_activity
from .sites import forget_account

router = APIRouter(prefix="/api", tags=["account"], dependencies=[Depends(require_client_header)])

DEMO_NOTICE = "Simulated fallback for the hackathon demo. This is not production authentication."
MAX_CODE_ATTEMPTS = 5


class Credentials(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(min_length=8, max_length=200)
    # Typing and clicks on the sign-in form (zones only; the password field is timing only).
    activity: Activity | None = None


class ConsentBody(BaseModel):
    agree: bool
    keep_raw: bool = False


class TrustVerify(BaseModel):
    code: str = Field(min_length=6, max_length=6)
    verification_id: str | None = Field(default=None, max_length=32)


def _me(db: Db, account: Account, session) -> dict:
    model = active_model()
    return {
        "username": account.username,
        "consent": account.consent_at is not None,
        "keep_raw": account.keep_raw,
        "trusted": is_trusted(session),
        "profile": profile_status(db, account, session),
        "passive": passive_profile(db, account.id, session),
        "setup": setup_status(db, account),
        "learning": learning_open(account, session),
        "model": None if model is None else {"version": model.version, "source": model.source},
        "retention_days": settings.retention_days,
    }


@router.post("/auth/register")
def register(body: Credentials, response: Response, db: Db) -> dict:
    username = normalise_username(body.username)
    if username is None:
        raise HTTPException(400, "invalid_username")
    if db.scalar(select(Account.id).where(Account.username == username)):
        raise HTTPException(409, "username_taken")
    account = Account(username=username, password_hash=hash_password(body.password))
    db.add(account)
    db.flush()
    session = open_session(db, response, kind="app", account_id=account.id)
    db.commit()
    return _me(db, account, session)


@router.post("/auth/login")
def login(body: Credentials, response: Response, db: Db) -> dict:
    username = normalise_username(body.username)
    account = db.scalar(select(Account).where(Account.username == username)) if username else None
    # Same error for an unknown user and a wrong password.
    if account is None or not verify_password(body.password, account.password_hash):
        raise HTTPException(401, "invalid_credentials")
    session = open_session(db, response, kind="app", account_id=account.id)
    db.flush()
    if body.activity is not None:
        check_activity(body.activity)
        record_sign_in(db, account, session, body.activity.model_dump())
    db.commit()
    return _me(db, account, session)


@router.post("/auth/logout", status_code=204)
def logout(session: CurrentSession, response: Response, db: Db) -> None:
    session.expires_at = now()
    db.commit()
    close_session(response)


@router.get("/me")
def me(session: OptionalSession, db: Db) -> dict | None:
    """The signed-in account, or null for a signed-out visitor."""
    account = db.get(Account, session.account_id) if session and session.kind == "app" else None
    return _me(db, account, session) if account else None


@router.post("/consent")
def consent(body: ConsentBody, account: CurrentAccount, session: CurrentSession, db: Db) -> dict:
    account.consent_at = now() if body.agree else None
    account.keep_raw = body.agree and body.keep_raw
    db.commit()
    return _me(db, account, session)


@router.delete("/profile")
def delete_profile(account: CurrentAccount, session: CurrentSession, db: Db) -> dict:
    """Delete the movement profile and every interaction stored for this account."""
    if not is_trusted(session):
        raise HTTPException(403, "trusted_verification_required")
    sample_ids = select(Sample.id).where(Sample.account_id == account.id)
    db.execute(delete(SampleFeatures).where(SampleFeatures.sample_id.in_(sample_ids)))
    db.execute(delete(Sample).where(Sample.account_id == account.id))
    db.execute(delete(PassiveWindow).where(PassiveWindow.account_id == account.id))
    db.execute(delete(Verification).where(Verification.account_id == account.id))
    forget_account(db, account.id)
    account.consent_at = None
    account.setup_completed_at = None
    account.keep_raw = False
    db.commit()
    return _me(db, account, session)


def _hash_code(code: str, session_id: int) -> str:
    return hashlib.sha256(f"{session_id}:{code}".encode()).hexdigest()


@router.post("/trust/start")
def trust_start(account: CurrentAccount, session: CurrentSession, db: Db) -> dict:
    """SIMULATED fallback: issue a one-time code and hand it straight back for display.

    A real deployment would verify a passkey here. Showing the code on the same screen
    proves nothing about the person, which is why every surface labels it demo-only.
    """
    code = f"{secrets.randbelow(10**6):06d}"
    db.execute(delete(TrustCode).where(TrustCode.session_id == session.id))
    db.add(
        TrustCode(
            session_id=session.id,
            code_hash=_hash_code(code, session.id),
            expires_at=now() + settings.trust_code_ttl_s,
        )
    )
    db.commit()
    return {"demo_only": True, "notice": DEMO_NOTICE, "demo_code": code, "expires_in_s": settings.trust_code_ttl_s}


@router.post("/trust/verify")
def trust_verify(body: TrustVerify, account: CurrentAccount, session: CurrentSession, db: Db) -> dict:
    record = db.scalar(select(TrustCode).where(TrustCode.session_id == session.id, TrustCode.used_at.is_(None)))
    if record is None or now() > record.expires_at or record.attempts >= MAX_CODE_ATTEMPTS:
        raise HTTPException(400, "code_expired")
    if not hmac.compare_digest(record.code_hash, _hash_code(body.code, session.id)):
        record.attempts += 1
        db.commit()
        raise HTTPException(400, "code_incorrect")

    record.used_at = now()
    session.trusted_at = now()
    grant: ActionGrant | None = None
    if body.verification_id:
        verification = db.get(Verification, body.verification_id)
        if verification and verification.session_id == session.id and verification.resolved_by is None:
            verification.resolved_by = "fallback"
            verification.updated_at = now()
            grant = issue_grant(db, session, verification.action, basis="fallback")
    db.commit()
    return {"trusted": True, "demo_only": True, "grant": grant.id if grant else None, "me": _me(db, account, session)}
