import json
import secrets
import zlib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update

from ..challenges.replay import replay_round
from ..challenges.spec import SPEC_VERSION, generate_layout
from ..collect import collect_status
from ..core.config import settings
from ..core.db import Db
from ..core.models import Challenge, Sample, now
from ..core.security import CurrentSession, require_client_header
from .schemas import ChallengeOut, Submission, SubmitResult

router = APIRouter(
    prefix="/api/challenges", tags=["challenges"], dependencies=[Depends(require_client_header)]
)


@router.post("", response_model=ChallengeOut)
def issue(db: Db, session: CurrentSession) -> ChallengeOut:
    if session.kind != "collect":
        raise HTTPException(400, "challenges_for_this_session_kind_not_available_yet")
    status = collect_status(db, session)
    if status.complete:
        raise HTTPException(409, "session_complete")

    recent = db.scalar(
        select(func.count())
        .select_from(Challenge)
        .where(
            Challenge.session_id == session.id,
            Challenge.issued_at > now() - settings.challenge_rate_window_s,
        )
    )
    if recent >= settings.challenge_rate_collect:
        raise HTTPException(429, "challenge_rate_limited")

    seed = secrets.randbits(62)
    layout = generate_layout(seed)
    challenge = Challenge(
        id=secrets.token_hex(16),
        session_id=session.id,
        purpose="collect",
        is_warmup=not status.warmup_done,
        task_version=SPEC_VERSION,
        seed=seed,
        layout_json=json.dumps(layout),
        expires_at=now() + settings.challenge_ttl_s,
    )
    db.add(challenge)
    db.commit()
    return ChallengeOut(
        id=challenge.id,
        expires_in_ms=settings.challenge_ttl_s * 1000,
        is_warmup=challenge.is_warmup,
        layout=layout,
    )


@router.post("/{challenge_id}/submit", response_model=SubmitResult)
def submit(challenge_id: str, body: Submission, db: Db, session: CurrentSession) -> SubmitResult:
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

    db.add(
        Sample(
            challenge_id=challenge.id,
            session_id=session.id,
            participant_id=session.participant_id,
            account_id=session.account_id,
            purpose=challenge.purpose,
            source="volunteer",
            is_warmup=challenge.is_warmup,
            task_version=challenge.task_version,
            events_z=zlib.compress(json.dumps(body.events, separators=(",", ":")).encode()),
            timeline_json=json.dumps(result.timeline),
            meta_json=body.meta.model_dump_json(),
        )
    )
    db.flush()
    status = collect_status(db, session)
    if status.complete and session.completed_at is None:
        session.completed_at = received
    db.commit()
    return SubmitResult(accepted=True, collect=status)
