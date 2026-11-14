from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select

from ..collect import collect_status, is_valid_code, new_code, split_of
from ..core.config import settings
from ..core.db import Db
from ..core.models import Participant, Sample, UserSession, now
from ..core.security import OptionalSession, close_session, open_session, require_client_header
from .schemas import CollectStart, CollectStatus

router = APIRouter(prefix="/api/collect", tags=["collect"])


@router.post("/start", response_model=CollectStatus, dependencies=[Depends(require_client_header)])
def start(body: CollectStart, response: Response, db: Db) -> CollectStatus:
    if not body.consent:
        raise HTTPException(400, "consent_required")

    participant = None
    if body.participant_code:
        code = body.participant_code.strip().upper()
        if not is_valid_code(code):
            raise HTTPException(404, "unknown_participant_code")
        participant = db.scalar(select(Participant).where(Participant.code == code))
    else:
        code = new_code(db)
    if participant is None:
        # A valid code this laptop has not seen was issued by another collection laptop.
        participant = Participant(
            code=code,
            split="pilot" if body.is_pilot else split_of(code),
            is_pilot=body.is_pilot,
            consent_raw_at=now(),
        )
        db.add(participant)
        db.flush()

    finished = db.scalars(
        select(UserSession)
        .where(UserSession.participant_id == participant.id, UserSession.completed_at.is_not(None))
        .order_by(UserSession.completed_at)
    ).all()
    if finished:
        last = finished[-1]
        same_setup = (last.station, last.declared_device) == (body.station, body.declared_device)
        wait = last.completed_at + settings.collect_min_gap_s - now()
        # Sessions on the same setup must be separated in time; a different device may follow at once.
        if same_setup and wait > 0:
            raise HTTPException(409, {"code": "too_soon", "retry_in_s": int(wait) + 1})

    session = open_session(
        db,
        response,
        kind="collect",
        participant_id=participant.id,
        label=chr(ord("A") + min(len(finished), 25)),
        declared_device=body.declared_device,
        station=body.station,
    )
    db.commit()
    return collect_status(db, session)


@router.get("/status", response_model=CollectStatus | None)
def status(db: Db, session: OptionalSession) -> CollectStatus | None:
    """Progress of the collection session open in this browser, or null when there is none."""
    if session is None or session.kind != "collect":
        return None
    return collect_status(db, session)


@router.post("/finish", status_code=204, dependencies=[Depends(require_client_header)])
def finish(response: Response) -> None:
    close_session(response)


@router.get("/overview")
def overview(db: Db) -> dict:
    """Recruiting progress for the team. Counts only; no participant codes."""
    by_split = dict(
        db.execute(select(Participant.split, func.count()).group_by(Participant.split)).all()
    )
    sessions = db.execute(
        select(UserSession.label, UserSession.station, UserSession.declared_device, func.count())
        .where(UserSession.kind == "collect", UserSession.completed_at.is_not(None))
        .group_by(UserSession.label, UserSession.station, UserSession.declared_device)
    ).all()
    return {
        "participants_by_split": by_split,
        "completed_sessions": [
            {"label": label, "station": station, "device": device, "count": count}
            for label, station, device, count in sessions
        ],
        "scored_rounds": db.scalar(
            select(func.count()).select_from(Sample).where(Sample.is_warmup.is_(False))
        ),
    }
