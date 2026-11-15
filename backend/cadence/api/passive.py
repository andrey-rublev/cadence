"""Passive windows: ordinary pointer and keyboard use, sent by the SDK while a consenting user works."""

import hashlib
import json
import math
import zlib
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..core.config import settings
from ..core.db import Db
from ..core.models import PassiveWindow, now
from ..core.security import CurrentSession, require_client_header
from ..features.keys import KEY_SCHEMA, MODIFIER, presses_from_events
from ..features.keys import window_vector as key_vector
from ..features.strokes import K_SCHEMA, strokes
from ..features.strokes import window_vector as stroke_vector
from ..passive import passive_profile
from ..product import CurrentAccount, is_trusted

router = APIRouter(prefix="/api", tags=["passive"], dependencies=[Depends(require_client_header)])

MIN_STROKES = 8
MIN_KEYS = 40
MAX_WINDOW_MS = 10 * 60_000

Number = Annotated[float, Field(allow_inf_nan=False)]


class PassiveBody(BaseModel):
    modality: Literal["pointer", "keys"]
    # pointer: [t_ms, x, y, kind, buttons]; keys: [t_ms, kind, zone]
    events: list[list[Number]] = Field(min_length=2, max_length=40_000)
    duration_ms: Number = Field(ge=0, le=MAX_WINDOW_MS)


def _validate(body: PassiveBody) -> None:
    width = 5 if body.modality == "pointer" else 3
    if body.modality == "keys" and len(body.events) > 2_000:
        raise HTTPException(422, "too_many_events")
    last = 0.0
    for event in body.events:
        if len(event) != width:
            raise HTTPException(422, "malformed_event")
        t, kind = event[0], int(event[3] if width == 5 else event[1])
        if t < last or t > MAX_WINDOW_MS:
            raise HTTPException(422, "timestamps_not_monotonic")
        last = t
        if width == 5 and kind not in (0, 1, 2):
            raise HTTPException(422, "malformed_event")
        if width == 3 and (kind not in (1, 2) or not 0 <= event[2] <= MODIFIER or event[2] != math.floor(event[2])):
            raise HTTPException(422, "malformed_event")
    if abs(last - body.duration_ms) > 1:
        raise HTTPException(422, "duration_mismatch")


@router.post("/passive")
def submit_window(body: PassiveBody, account: CurrentAccount, session: CurrentSession, db: Db) -> dict:
    """Store one window as enrollment (trusted session) or as evidence for this session."""
    if account.consent_at is None:
        raise HTTPException(403, "consent_required")
    _validate(body)

    recent = db.scalar(
        select(func.count()).where(
            PassiveWindow.session_id == session.id,
            PassiveWindow.captured_at >= now() - settings.passive_rate_window_s,
        )
    )
    if recent >= settings.passive_rate_limit:
        raise HTTPException(429, "too_many_windows")

    # A window cannot have taken longer than the server has seen since the previous one
    # (or since sign-in). Stops a recording made elsewhere being sent in a burst.
    previous = db.scalar(select(func.max(PassiveWindow.captured_at)).where(PassiveWindow.session_id == session.id))
    elapsed_ms = (now() - (previous or session.created_at)) * 1000
    if body.duration_ms > elapsed_ms + settings.passive_clock_slack_ms:
        raise HTTPException(422, "client_clock_ahead_of_server")

    canonical = json.dumps([body.modality, body.events], separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    if db.scalar(select(PassiveWindow.id).where(PassiveWindow.account_id == account.id, PassiveWindow.digest == digest)):
        raise HTTPException(409, "window_already_used")

    if body.modality == "pointer":
        found = strokes(body.events)
        if len(found) < MIN_STROKES:
            raise HTTPException(422, "too_little_movement")
        vector, schema = stroke_vector(found), K_SCHEMA
    else:
        presses = presses_from_events(body.events)
        if sum(z != MODIFIER for _, _, z in presses) < MIN_KEYS:
            raise HTTPException(422, "too_little_typing")
        vector, schema = key_vector(presses), KEY_SCHEMA

    purpose = "enroll" if is_trusted(session) else "evidence"
    db.add(
        PassiveWindow(
            session_id=session.id,
            account_id=account.id,
            modality=body.modality,
            purpose=purpose,
            feature_schema=schema,
            values_json=json.dumps([None if not math.isfinite(v) else v for v in vector.tolist()]),
            digest=digest,
            events_z=zlib.compress(canonical.encode()) if account.keep_raw else None,
            duration_ms=body.duration_ms,
        )
    )
    db.commit()
    return {"purpose": purpose, "modality": body.modality, "passive": passive_profile(db, account.id, session)}
