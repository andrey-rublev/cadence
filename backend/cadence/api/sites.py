"""Cadence for third-party sites: a second factor made from how the person types and clicks.

Browser (partner page)  --activity-->  POST /v1/evidence      -> opaque evidence token
Partner server          --secret---->  POST /v1/checks        -> decision for a linked person
Person, if not released  ----------->  Cadence /verify/<id>   -> demo authenticator (simulated)
Partner server          --secret---->  GET  /v1/checks/<id>   -> resolved by fallback?

Linking is OAuth-style: the partner sends the person to Cadence /connect, the person approves
while signed in to Cadence, and the partner exchanges the one-time code for an opaque
`subject`. The partner never sees timing data, and Cadence never sees the partner's password.
Evidence that led to a verified check (behaviour or fallback) is added to the profile, so
each verified sign-in makes the next check better informed.
"""

import hashlib
import hmac
import json
import secrets
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.db import Db
from ..core.models import Account, EvidenceToken, LinkCode, PassiveWindow, Site, SiteCheck, SiteLink, now
from ..core.security import require_client_header
from ..passive import MODALITIES, decide_evidence, evidence_windows, recommend_test, window_digest
from ..policy import CONSISTENT
from ..product import CurrentAccount
from ..setup import site_session
from .passive import Activity, check_activity

partners = APIRouter(prefix="/v1", tags=["partners"])  # called by partner browsers and servers
people = APIRouter(prefix="/api", tags=["sites"], dependencies=[Depends(require_client_header)])  # the Cadence site

DEMO_NOTICE = "Simulated fallback for the hackathon demo. This is not production authentication."
MAX_CODE_ATTEMPTS = 5


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def register_demo_site(db: Session) -> None:
    """Register (or refresh) the demo partner from settings."""
    site = db.get(Site, settings.demo_site_id) or Site(id=settings.demo_site_id)
    site.name = settings.demo_site_name
    site.site_key = settings.demo_site_key
    site.secret_hash = _sha(settings.demo_site_secret)
    site.origins_json = json.dumps(settings.demo_site_origins)
    site.redirect_uris_json = json.dumps(settings.demo_site_redirects)
    db.merge(site)
    db.commit()


def allowed_origins() -> list[str]:
    return list(settings.demo_site_origins)


def site_by_key(db: Session, key: str | None) -> Site:
    site = db.scalar(select(Site).where(Site.site_key == key)) if key else None
    if site is None:
        raise HTTPException(401, "unknown_site")
    return site


def site_by_secret(db: Db, authorization: Annotated[str | None, Header()] = None) -> Site:
    """Server-to-server calls carry `Authorization: Bearer <site secret>`."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "site_secret_required")
    hashed = _sha(authorization.removeprefix("Bearer ").strip())
    for site in db.scalars(select(Site)).all():
        if hmac.compare_digest(site.secret_hash, hashed):
            return site
    raise HTTPException(401, "site_secret_invalid")


SiteBySecret = Annotated[Site, Depends(site_by_secret)]


# ---------------------------------------------------------------- partner browser


@partners.post("/evidence")
def submit_evidence(
    body: Activity, request: Request, db: Db, x_cadence_site: Annotated[str | None, Header()] = None
) -> dict:
    """Activity from a partner page, sent by the person's browser straight to Cadence."""
    site = site_by_key(db, x_cadence_site)
    origin = request.headers.get("origin")
    if origin not in json.loads(site.origins_json):
        raise HTTPException(403, "origin_not_allowed")
    check_activity(body)
    recent = db.scalar(
        select(func.count()).where(EvidenceToken.site_id == site.id, EvidenceToken.created_at >= now() - 60)
    )
    if recent >= settings.evidence_rate_limit:
        raise HTTPException(429, "too_many_requests")
    digest = _sha(json.dumps([body.keys, body.pointer], separators=(",", ":")))
    if (body.keys or body.pointer) and db.scalar(
        select(EvidenceToken.token_hash).where(EvidenceToken.site_id == site.id, EvidenceToken.digest == digest)
    ):
        raise HTTPException(409, "evidence_already_used")

    windows = evidence_windows(body.keys, body.pointer)
    token = secrets.token_urlsafe(32)
    db.add(
        EvidenceToken(
            token_hash=_sha(token),
            site_id=site.id,
            windows_json=json.dumps(windows),
            keys=sum(w.get("keys", 0) for w in windows),
            strokes=sum(w.get("strokes", 0) for w in windows),
            digest=digest,
            expires_at=now() + settings.evidence_ttl_s,
        )
    )
    db.commit()
    return {
        "token": token,
        "expires_in_s": settings.evidence_ttl_s,
        "keys": sum(w.get("keys", 0) for w in windows),
        "clicks": sum(w.get("strokes", 0) for w in windows),
    }


# ---------------------------------------------------------------- partner server


class CheckBody(BaseModel):
    subject: str = Field(max_length=64)
    evidence: str | None = Field(default=None, max_length=64)  # token from /v1/evidence; none means no activity
    action: str = Field(default="sign_in", max_length=40)


def _claim_evidence(db: Session, site: Site, token: str | None) -> list[dict]:
    if token is None:
        return []
    record = db.get(EvidenceToken, _sha(token))
    if record is None or record.site_id != site.id:
        raise HTTPException(400, "evidence_unknown")
    if now() > record.expires_at:
        raise HTTPException(400, "evidence_expired")
    claimed = db.execute(
        update(EvidenceToken)
        .where(EvidenceToken.token_hash == record.token_hash, EvidenceToken.used_at.is_(None))
        .values(used_at=now())
    )
    if claimed.rowcount != 1:
        raise HTTPException(400, "evidence_already_used")
    return json.loads(record.windows_json)


def _link(db: Session, site: Site, subject: str) -> SiteLink:
    link = db.scalar(select(SiteLink).where(SiteLink.subject == subject, SiteLink.site_id == site.id))
    if link is None or link.revoked_at is not None:
        raise HTTPException(404, "subject_not_linked")
    return link


def learn(db: Session, check: SiteCheck) -> int:
    """Add the evidence of a verified check to the profile. Caller commits."""
    if check.learned or check.resolved_by is None:
        return 0
    windows = json.loads(check.windows_json)
    check.learned = True
    if not windows:
        return 0
    session = site_session(db, check.account_id)
    for window in windows:
        db.add(
            PassiveWindow(
                session_id=session.id,
                account_id=check.account_id,
                modality=window["modality"],
                purpose="login" if window["use"] == "login" else "enroll",
                feature_schema=MODALITIES[window["modality"]]["schema"],
                values_json=json.dumps(window["values"]),
                digest=window_digest(window, f"check:{check.id}"),
                duration_ms=0,
            )
        )
    return len(windows)


def check_view(db: Session, check: SiteCheck) -> dict:
    decision = json.loads(check.decision_json)
    resolved = check.resolved_by is not None
    return {
        "check_id": check.id,
        "action": check.action,
        "outcome": decision["outcome"],
        "reason": decision["reason"],
        "parts": decision["parts"],
        "resolved": resolved,
        "resolved_by": check.resolved_by,
        "expired": not resolved and now() > check.expires_at,
        # Where to send the person when the check did not release the action.
        "verify_url": None if resolved else f"{settings.cadence_web_url}/verify/{check.id}",
        "demo_only_fallback": True,
    }


@partners.post("/checks")
def create_check(body: CheckBody, site: SiteBySecret, db: Db) -> dict:
    """Decide a sign-in or sensitive action for a linked person from their browser's evidence."""
    link = _link(db, site, body.subject)
    windows = _claim_evidence(db, site, body.evidence)
    decision = decide_evidence(db, link.account_id, windows)
    check = SiteCheck(
        id=secrets.token_hex(16),
        site_id=site.id,
        account_id=link.account_id,
        action=body.action,
        decision_json=json.dumps(decision.to_dict()),
        windows_json=json.dumps(windows),
        expires_at=now() + settings.site_check_ttl_s,
    )
    db.add(check)
    if decision.outcome == CONSISTENT:
        check.resolved_by, check.resolved_at = "behavior", now()
        learn(db, check)
    db.commit()
    return check_view(db, check)


@partners.get("/checks/{check_id}")
def read_check(check_id: str, site: SiteBySecret, db: Db) -> dict:
    check = db.get(SiteCheck, check_id)
    if check is None or check.site_id != site.id:
        raise HTTPException(404, "check_unknown")
    return check_view(db, check)


class ExchangeBody(BaseModel):
    code: str = Field(max_length=64)


@partners.post("/links/exchange")
def exchange_link_code(body: ExchangeBody, site: SiteBySecret, db: Db) -> dict:
    record = db.get(LinkCode, _sha(body.code))
    link = db.get(SiteLink, record.link_id) if record else None
    if record is None or link is None or link.site_id != site.id or link.revoked_at is not None:
        raise HTTPException(400, "code_invalid")
    if now() > record.expires_at:
        raise HTTPException(400, "code_expired")
    claimed = db.execute(
        update(LinkCode).where(LinkCode.code_hash == record.code_hash, LinkCode.used_at.is_(None)).values(used_at=now())
    )
    db.commit()
    if claimed.rowcount != 1:
        raise HTTPException(400, "code_already_used")
    account = db.get(Account, link.account_id)
    return {"subject": link.subject, "cadence_username": account.username if account else None}


# ---------------------------------------------------------------- the person, on the Cadence site


@people.get("/sites/{site_key}")
def describe_site(site_key: str, redirect_uri: str, db: Db) -> dict:
    """What the connect page shows before the person approves."""
    site = site_by_key(db, site_key)
    if redirect_uri not in json.loads(site.redirect_uris_json):
        raise HTTPException(400, "redirect_not_allowed")
    return {"name": site.name, "site_key": site.site_key}


class ConnectBody(BaseModel):
    site_key: str = Field(max_length=64)
    redirect_uri: str = Field(max_length=300)
    state: str = Field(max_length=200)


@people.post("/sites/connect")
def connect_site(body: ConnectBody, account: CurrentAccount, db: Db) -> dict:
    """The person approves a site. Returns where to send them back, with a one-time code."""
    site = site_by_key(db, body.site_key)
    if body.redirect_uri not in json.loads(site.redirect_uris_json):
        raise HTTPException(400, "redirect_not_allowed")
    link = db.scalar(
        select(SiteLink).where(
            SiteLink.site_id == site.id, SiteLink.account_id == account.id, SiteLink.revoked_at.is_(None)
        )
    )
    if link is None:
        link = SiteLink(site_id=site.id, account_id=account.id, subject=secrets.token_urlsafe(24))
        db.add(link)
        db.flush()
    code = secrets.token_urlsafe(24)
    db.add(LinkCode(code_hash=_sha(code), link_id=link.id, expires_at=now() + settings.link_code_ttl_s))
    db.commit()
    return {"redirect": f"{body.redirect_uri}?{urlencode({'code': code, 'state': body.state})}"}


@people.get("/sites")
def my_sites(account: CurrentAccount, db: Db) -> dict:
    """Sites this person has connected, and their recent checks."""
    links = db.execute(
        select(SiteLink, Site.name)
        .join(Site, Site.id == SiteLink.site_id)
        .where(SiteLink.account_id == account.id, SiteLink.revoked_at.is_(None))
    ).all()
    checks = db.execute(
        select(SiteCheck, Site.name)
        .join(Site, Site.id == SiteCheck.site_id)
        .where(SiteCheck.account_id == account.id)
        .order_by(SiteCheck.created_at.desc())
        .limit(20)
    ).all()
    return {
        "sites": [{"id": link.id, "name": name, "since": link.created_at} for link, name in links],
        "checks": [
            {
                "id": check.id,
                "site": name,
                "action": check.action,
                "at": check.created_at,
                "resolved_by": check.resolved_by,
                "learned": check.learned,
                "decision": json.loads(check.decision_json),
            }
            for check, name in checks
        ],
    }


@people.delete("/sites/{link_id}")
def disconnect_site(link_id: int, account: CurrentAccount, db: Db) -> dict:
    link = db.get(SiteLink, link_id)
    if link is None or link.account_id != account.id:
        raise HTTPException(404, "site_unknown")
    link.revoked_at = now()
    db.commit()
    return my_sites(account, db)


# ---------------------------------------------------------------- verifying another way


def _open_check(db: Session, check_id: str) -> SiteCheck:
    check = db.get(SiteCheck, check_id)
    if check is None:
        raise HTTPException(404, "check_unknown")
    return check


@people.get("/stepup/{check_id}")
def stepup_info(check_id: str, db: Db) -> dict:
    check = _open_check(db, check_id)
    site = db.get(Site, check.site_id)
    account = db.get(Account, check.account_id)
    view = check_view(db, check)
    return {
        "site": site.name if site else "",
        "username": account.username if account else "",
        "action": check.action,
        "outcome": view["outcome"],
        "reason": view["reason"],
        "parts": view["parts"],
        "resolved": view["resolved"],
        "resolved_by": check.resolved_by,
        "expired": view["expired"],
        "tests_left": max(0, MAX_TESTS - check.stepup_tests),
        "recommendation": recommend_test(db, check.account_id),
    }


MAX_TESTS = 2


@people.post("/stepup/{check_id}/test")
def stepup_test(check_id: str, body: Activity, db: Db) -> dict:
    """A short personalised test (a typed sentence or a few clicks) instead of the authenticator.
    Scored on its own: the evidence that was unsure is not mixed back in."""
    check = _open_check(db, check_id)
    if check.resolved_by is not None or now() > check.expires_at:
        raise HTTPException(409, "check_closed")
    if check.stepup_tests >= MAX_TESTS:
        raise HTTPException(429, "no_tests_left")
    check_activity(body)
    windows = evidence_windows(body.keys, body.pointer)
    check.stepup_tests += 1
    decision = decide_evidence(db, check.account_id, windows)
    if decision.outcome == CONSISTENT:
        check.resolved_by, check.resolved_at = "test", now()
        # Both the original evidence and the test now belong to a verified sitting.
        check.windows_json = json.dumps(json.loads(check.windows_json) + windows)
        learn(db, check)
    db.commit()
    return {
        "decision": decision.to_dict(),
        "resolved": check.resolved_by is not None,
        "tests_left": max(0, MAX_TESTS - check.stepup_tests),
    }


def _code_hash(code: str, check_id: str) -> str:
    return _sha(f"stepup:{check_id}:{code}")


@people.post("/stepup/{check_id}/start")
def stepup_start(check_id: str, db: Db) -> dict:
    """SIMULATED fallback: a one-time code shown on screen. A real deployment would ask for the
    passkey registered to the Cadence account here; showing the code proves nothing."""
    check = _open_check(db, check_id)
    if check.resolved_by is not None or now() > check.expires_at:
        raise HTTPException(409, "check_closed")
    code = f"{secrets.randbelow(10**6):06d}"
    check.stepup_code_hash, check.stepup_attempts = _code_hash(code, check.id), 0
    db.commit()
    return {"demo_only": True, "notice": DEMO_NOTICE, "demo_code": code, "expires_in_s": settings.trust_code_ttl_s}


class StepUpBody(BaseModel):
    code: str = Field(min_length=6, max_length=6)


@people.post("/stepup/{check_id}/verify")
def stepup_verify(check_id: str, body: StepUpBody, db: Db) -> dict:
    check = _open_check(db, check_id)
    if check.resolved_by is not None or now() > check.expires_at or check.stepup_code_hash is None:
        raise HTTPException(409, "check_closed")
    if check.stepup_attempts >= MAX_CODE_ATTEMPTS:
        raise HTTPException(400, "code_expired")
    if not hmac.compare_digest(check.stepup_code_hash, _code_hash(body.code, check.id)):
        check.stepup_attempts += 1
        db.commit()
        raise HTTPException(400, "code_incorrect")
    check.resolved_by, check.resolved_at, check.stepup_code_hash = "fallback", now(), None
    learned = learn(db, check)
    db.commit()
    return {"resolved": True, "resolved_by": "fallback", "learned_windows": learned, "demo_only": True}


def forget_account(db: Session, account_id: int) -> None:
    """Remove links, checks and codes when a person deletes their Cadence profile."""
    link_ids = select(SiteLink.id).where(SiteLink.account_id == account_id)
    db.execute(delete(LinkCode).where(LinkCode.link_id.in_(link_ids)))
    db.execute(update(SiteLink).where(SiteLink.account_id == account_id).values(revoked_at=now()))
    db.execute(delete(SiteCheck).where(SiteCheck.account_id == account_id))
