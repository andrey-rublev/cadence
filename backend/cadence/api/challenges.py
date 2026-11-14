import json
import secrets
import zlib

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..challenges.replay import replay_round
from ..challenges.spec import SPEC_VERSION, generate_layout
from ..collect import collect_status
from ..core.config import settings
from ..core.db import Db
from ..core.models import Account, Challenge, Sample, SampleFeatures, UserSession, Verification, now
from ..core.security import CurrentSession, require_client_header
from ..features.extract import FEATURE_SCHEMA, extract_round, to_vector
from ..policy import CONSISTENT, decide
from ..product import active_model, enrollment, is_trusted, issue_grant, profile_status
from .schemas import ChallengeOut, Submission

router = APIRouter(
    prefix="/api/challenges", tags=["challenges"], dependencies=[Depends(require_client_header)]
)


class ChallengeRequest(BaseModel):
    purpose: str = Field(pattern="^(enroll|verify)$")
    verification_id: str | None = Field(default=None, max_length=32)


def _recent(db: Session, session: UserSession, purpose: str) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Challenge)
        .where(
            Challenge.session_id == session.id,
            Challenge.purpose == purpose,
            Challenge.issued_at > now() - settings.challenge_rate_window_s,
        )
    )


def _open_verification(db: Session, session: UserSession, verification_id: str | None) -> Verification:
    verification = db.get(Verification, verification_id) if verification_id else None
    if verification is None or verification.session_id != session.id:
        raise HTTPException(404, "unknown_verification")
    if verification.resolved_by is not None:
        raise HTTPException(409, "verification_already_resolved")
    return verification


@router.post("", response_model=ChallengeOut)
def issue(db: Db, session: CurrentSession, body: ChallengeRequest | None = None) -> ChallengeOut:
    is_warmup = False
    verification: Verification | None = None

    if session.kind == "collect":
        purpose, limit = "collect", settings.challenge_rate_collect
        status = collect_status(db, session)
        if status.complete:
            raise HTTPException(409, "session_complete")
        is_warmup = not status.warmup_done

    elif body is None:
        raise HTTPException(400, "purpose_required")

    elif body.purpose == "enroll":
        # The profile is only ever built from activity that follows trusted verification.
        purpose, limit = "enroll", settings.challenge_rate_collect
        account = db.get(Account, session.account_id)
        if account.consent_at is None:
            raise HTTPException(403, "consent_required")
        if not is_trusted(session):
            raise HTTPException(403, "trusted_verification_required")
        progress = profile_status(db, account, session)["this_session"]
        if progress["rounds"] >= progress["rounds_total"]:
            raise HTTPException(409, "enrollment_session_complete")
        is_warmup = not progress["practice_done"]

    else:
        purpose, limit = "verify", settings.challenge_rate_verify
        verification = _open_verification(db, session, body.verification_id)
        if len(json.loads(verification.probes_json)) >= settings.verify_max_rounds:
            raise HTTPException(409, "no_rounds_left")

    if _recent(db, session, purpose) >= limit:
        raise HTTPException(429, "challenge_rate_limited")

    seed = secrets.randbits(62)
    layout = generate_layout(seed)
    challenge = Challenge(
        id=secrets.token_hex(16),
        session_id=session.id,
        purpose=purpose,
        is_warmup=is_warmup,
        task_version=SPEC_VERSION,
        seed=seed,
        layout_json=json.dumps(layout),
        expires_at=now() + settings.challenge_ttl_s,
    )
    db.add(challenge)
    if verification is not None:
        verification.challenge_id = challenge.id
    db.commit()
    return ChallengeOut(
        id=challenge.id,
        expires_in_ms=settings.challenge_ttl_s * 1000,
        is_warmup=is_warmup,
        layout=layout,
    )


def _store_sample(db: Session, session: UserSession, challenge: Challenge, body: Submission, timeline, *, source, keep_raw):
    sample = Sample(
        challenge_id=challenge.id,
        session_id=session.id,
        participant_id=session.participant_id,
        account_id=session.account_id,
        purpose=challenge.purpose,
        source=source,
        is_warmup=challenge.is_warmup,
        task_version=challenge.task_version,
        events_z=zlib.compress(json.dumps(body.events, separators=(",", ":")).encode()) if keep_raw else None,
        timeline_json=json.dumps(timeline),
        meta_json=body.meta.model_dump_json(),
    )
    db.add(sample)
    db.flush()
    return sample


@router.post("/{challenge_id}/submit")
def submit(challenge_id: str, body: Submission, db: Db, session: CurrentSession) -> dict:
    challenge = db.get(Challenge, challenge_id)
    if challenge is None:
        raise HTTPException(404, "unknown_challenge")
    if challenge.session_id != session.id:
        raise HTTPException(403, "challenge_belongs_to_another_session")
    received = now()
    if received > challenge.expires_at:
        raise HTTPException(410, "challenge_expired")

    # Single use: the conditional update succeeds for exactly one submission, valid or not.
    claimed = db.execute(
        update(Challenge)
        .where(Challenge.id == challenge_id, Challenge.used_at.is_(None))
        .values(used_at=received)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise HTTPException(409, "challenge_already_used")

    layout = json.loads(challenge.layout_json)
    result = replay_round(layout, body.events, (received - challenge.issued_at) * 1000)
    if not result.ok:
        raise HTTPException(422, {"code": "round_rejected", "reason": result.reason})

    if challenge.purpose == "collect":
        _store_sample(db, session, challenge, body, result.timeline, source="volunteer", keep_raw=True)
        status = collect_status(db, session)
        if status.complete and session.completed_at is None:
            session.completed_at = received
        db.commit()
        return {"accepted": True, "collect": status.model_dump()}

    features = extract_round(layout, body.events, result.timeline)
    account = db.get(Account, session.account_id)

    if challenge.purpose == "enroll":
        # Trust can lapse mid-round; the profile must not absorb what follows.
        if not is_trusted(session):
            raise HTTPException(403, "trusted_verification_required")
        sample = _store_sample(
            db, session, challenge, body, result.timeline, source="account", keep_raw=account.keep_raw
        )
        db.add(SampleFeatures(sample_id=sample.id, feature_schema=FEATURE_SCHEMA, values_json=json.dumps(features)))
        db.commit()
        return {"accepted": True, "profile": profile_status(db, account, session)}

    # Verification. The round is judged against the profile and never added to it.
    verification = db.scalar(select(Verification).where(Verification.challenge_id == challenge.id))
    if verification is None or verification.resolved_by is not None:
        raise HTTPException(409, "verification_already_resolved")
    probes = json.loads(verification.probes_json) + [features]
    vectors, sessions = enrollment(db, account.id)
    decision = decide(active_model(), vectors, sessions, [to_vector(p) for p in probes])
    verification.probes_json = json.dumps(probes)
    verification.decision_json = json.dumps(decision.to_dict())
    verification.challenge_id = None
    verification.updated_at = received
    grant = None
    if decision.outcome == CONSISTENT:
        verification.resolved_by = "behavior"
        grant = issue_grant(db, session, verification.action, basis="behavior")
    db.commit()
    return {
        "accepted": True,
        "decision": decision.to_dict(),
        "grant": grant.id if grant else None,
        "rounds_left": settings.verify_max_rounds - len(probes),
    }
