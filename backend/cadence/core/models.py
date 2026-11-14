"""Storage layer. Times are epoch seconds (float) to avoid SQLite timezone ambiguity."""

import time

from sqlalchemy import ForeignKey, Index, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now() -> float:
    return time.time()


class Participant(Base):
    """A consenting volunteer in collection mode, known only by a username they chose."""

    __tablename__ = "participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    # train | validation | test | pilot, a pure function of the username (see collect.split_of).
    split: Mapped[str] = mapped_column(String(12))
    is_pilot: Mapped[bool] = mapped_column(default=False)
    consent_raw_at: Mapped[float]
    created_at: Mapped[float] = mapped_column(default=now)


class UserSession(Base):
    """Server-side session. The cookie holds a random token; only its SHA-256 is stored."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(12))  # collect | app
    participant_id: Mapped[int | None] = mapped_column(ForeignKey("participants.id"))
    account_id: Mapped[int | None]
    label: Mapped[str | None] = mapped_column(String(4))  # collection session A, B, C...
    # Evaluation metadata only. Never a model input.
    declared_device: Mapped[str | None] = mapped_column(String(16))
    station: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[float] = mapped_column(default=now)
    expires_at: Mapped[float]
    completed_at: Mapped[float | None]
    trusted_at: Mapped[float | None]


class Challenge(Base):
    __tablename__ = "challenges"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # 128-bit random hex
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(12))  # collect | enroll | verify
    is_warmup: Mapped[bool] = mapped_column(default=False)
    task_version: Mapped[int]
    seed: Mapped[int]
    layout_json: Mapped[str]
    issued_at: Mapped[float] = mapped_column(default=now)
    expires_at: Mapped[float]
    used_at: Mapped[float | None]

    __table_args__ = (Index("ix_challenges_session_issued", "session_id", "issued_at"),)


class Sample(Base):
    """One completed challenge round. Raw events are kept only with consent."""

    __tablename__ = "samples"

    id: Mapped[int] = mapped_column(primary_key=True)
    challenge_id: Mapped[str] = mapped_column(ForeignKey("challenges.id"), unique=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    participant_id: Mapped[int | None] = mapped_column(ForeignKey("participants.id"), index=True)
    account_id: Mapped[int | None] = mapped_column(index=True)
    purpose: Mapped[str] = mapped_column(String(12))
    source: Mapped[str] = mapped_column(String(12))  # volunteer | account | synthetic
    is_warmup: Mapped[bool] = mapped_column(default=False)
    task_version: Mapped[int]
    events_z: Mapped[bytes | None] = mapped_column(LargeBinary)  # zlib-compressed JSON
    timeline_json: Mapped[str]  # server-derived task boundaries
    meta_json: Mapped[str]  # area scale, devicePixelRatio, pointer type
    captured_at: Mapped[float] = mapped_column(default=now)
