from typing import Any, Literal

from pydantic import BaseModel, Field

from ..challenges.replay import MAX_EVENTS

# One pointer sample: [t_ms, x, y, kind, buttons]; kind 0 = move, 1 = down, 2 = up.
Event = tuple[float, float, float, int, int]

DeclaredDevice = Literal["mouse", "trackpad", "laptop-keys", "external-keys", "other"]


class SubmissionMeta(BaseModel):
    scale: float = Field(gt=0.2, le=1.05)
    dpr: float = Field(gt=0, le=8)
    pointer_type: Literal["mouse", "pen", "touch", ""] = ""


class Submission(BaseModel):
    events: list[Event] = Field(max_length=MAX_EVENTS)
    meta: SubmissionMeta


class ChallengeOut(BaseModel):
    id: str
    expires_in_ms: int
    is_warmup: bool
    layout: dict[str, Any]


class CollectStart(BaseModel):
    consent: bool
    username: str = Field(max_length=64)
    returning: bool = False
    # A returning volunteer whose earlier session was recorded on a different laptop.
    earlier_session_elsewhere: bool = False
    declared_device: DeclaredDevice
    station: str = Field(min_length=1, max_length=40)
    is_pilot: bool = False


class CollectStatus(BaseModel):
    username: str
    label: str
    warmup_done: bool
    rounds_done: int
    rounds_total: int
    mode: str = "challenge"  # typing | challenge
    typing_done: int = 0
    typing_total: int = 0
    complete: bool

