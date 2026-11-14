from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select

from ..collect import collect_status, normalise_username, split_of
from ..core.db import Db
from ..core.models import Participant, Sample, UserSession, now
from ..core.security import OptionalSession, close_session, open_session, require_client_header
from .schemas import CollectStart, CollectStatus

router = APIRouter(prefix="/api/collect", tags=["collect"])


@router.post("/start", response_model=CollectStatus, dependencies=[Depends(require_client_header)])
def start(body: CollectStart, response: Response, db: Db) -> CollectStatus:
    if not body.consent:
        raise HTTPException(400, "consent_required")

    username = normalise_username(body.username)
    if username is None:
        raise HTTPException(400, "invalid_username")
    participant = db.scalar(select(Participant).where(Participant.username == username))
    finished = 0
    if participant is not None:
        finished = db.scalar(
            select(func.count())
            .select_from(UserSession)
            .where(UserSession.participant_id == participant.id, UserSession.completed_at.is_not(None))
        )

    # Usernames are typed by hand, so guard both ways: a newcomer must not join someone
    # else's recordings, and a returning volunteer's typo must not start a second identity.
    if not body.returning and finished:
        raise HTTPException(409, "username_taken")
    if body.returning and participant is None and not body.earlier_session_elsewhere:
        raise HTTPException(404, "unknown_username")

    if participant is None:
        participant = Participant(
            username=username,
            split="pilot" if body.is_pilot else split_of(username),
            is_pilot=body.is_pilot,
            consent_raw_at=now(),
        )
        db.add(participant)
        db.flush()

    session = open_session(
        db,
        response,
        kind="collect",
        participant_id=participant.id,
        label=chr(ord("A") + min(finished, 25)),
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
    """Recruiting progress for the team. Counts only; no usernames."""
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
