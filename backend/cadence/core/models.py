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
    # collect | app | site (a partner sign-in, recorded so verified evidence from it can be learned)
    kind: Mapped[str] = mapped_column(String(12))
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


class Account(Base):
    """A signed-up user of the mock company dashboard."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    # Consent to capture pointer movement; null until given. Withdrawn by deleting the profile.
    consent_at: Mapped[float | None]
    keep_raw: Mapped[bool] = mapped_column(default=False)  # raw trajectories kept for debugging
    # Set when the Cadence setup (click test, typing test, repeat sign-ins) is finished. Until
    # then everything recorded on the Cadence site builds the profile; afterwards only
    # verified checks and trusted sessions add to it.
    setup_completed_at: Mapped[float | None]
    created_at: Mapped[float] = mapped_column(default=now)


class Site(Base):
    """A third-party site that uses Cadence as a second factor."""

    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    site_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # public, used in the browser
    secret_hash: Mapped[str] = mapped_column(String(64))  # SHA-256 of the server-to-server secret
    origins_json: Mapped[str]  # browser origins allowed to send evidence
    redirect_uris_json: Mapped[str]  # where linking may return to
    created_at: Mapped[float] = mapped_column(default=now)


class SiteLink(Base):
    """A person's consent for one site to check them with Cadence. The site only ever sees `subject`."""

    __tablename__ = "site_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    subject: Mapped[str] = mapped_column(String(43), unique=True, index=True)  # opaque, per site
    created_at: Mapped[float] = mapped_column(default=now)
    revoked_at: Mapped[float | None]


class LinkCode(Base):
    """One-time code handed back to a site after the person approves linking (OAuth-style)."""

    __tablename__ = "link_codes"

    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    link_id: Mapped[int] = mapped_column(ForeignKey("site_links.id"))
    expires_at: Mapped[float]
    used_at: Mapped[float | None]


class EvidenceToken(Base):
    """Behaviour sent straight from the person's browser on a partner page. The partner only
    holds the opaque token; it never sees the timing data. Single use, short-lived."""

    __tablename__ = "evidence_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    # [{"modality", "feature_schema", "values", "keys"|"strokes"}] feature vectors, no raw events
    windows_json: Mapped[str]
    keys: Mapped[int]
    strokes: Mapped[int]
    digest: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[float] = mapped_column(default=now)
    expires_at: Mapped[float]
    used_at: Mapped[float | None]


class SiteCheck(Base):
    """One check a site asked for (a sign-in or a sensitive action) and how it ended."""

    __tablename__ = "site_checks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    decision_json: Mapped[str]
    windows_json: Mapped[str]  # the evidence, kept until the check resolves so it can be learned
    # behavior | test (a personalised step-up test) | fallback, or null while unresolved
    resolved_by: Mapped[str | None] = mapped_column(String(12))
    learned: Mapped[bool] = mapped_column(default=False)
    stepup_code_hash: Mapped[str | None] = mapped_column(String(64))
    stepup_attempts: Mapped[int] = mapped_column(default=0)
    stepup_tests: Mapped[int] = mapped_column(default=0)  # personalised tests taken instead of the code
    created_at: Mapped[float] = mapped_column(default=now)
    expires_at: Mapped[float]
    resolved_at: Mapped[float | None]


class TrustCode(Base):
    """A one-time code for the SIMULATED fallback. Demo only; not production authentication."""

    __tablename__ = "trust_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(default=0)
    expires_at: Mapped[float]
    used_at: Mapped[float | None]


class Verification(Base):
    """One attempt to clear a protected action. Accumulates rounds until it resolves."""

    __tablename__ = "verifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    account_id: Mapped[int] = mapped_column(index=True)
    action: Mapped[str] = mapped_column(String(40))
    challenge_id: Mapped[str | None] = mapped_column(String(32))  # the round currently issued
    probes_json: Mapped[str] = mapped_column(default="[]")  # feature vectors of submitted rounds
    decision_json: Mapped[str]
    resolved_by: Mapped[str | None] = mapped_column(String(12))  # behavior | fallback
    created_at: Mapped[float] = mapped_column(default=now)
    updated_at: Mapped[float] = mapped_column(default=now)


class ActionGrant(Base):
    """Server-side permission for one protected action in one session. Short-lived, single use."""

    __tablename__ = "action_grants"

    id: Mapped[str] = mapped_column(String(43), primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    account_id: Mapped[int]
    action: Mapped[str] = mapped_column(String(40))
    basis: Mapped[str] = mapped_column(String(12))  # behavior | fallback
    expires_at: Mapped[float]
    used_at: Mapped[float | None]
    created_at: Mapped[float] = mapped_column(default=now)


class PassiveWindow(Base):
    """A window of ordinary use (pointer strokes or key timing) captured without a task.

    Features are stored; raw events only when the account opted in. Key events hold timing
    and coarse keyboard zones, never characters.
    """

    __tablename__ = "passive_windows"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    # Exactly one of these is set: an app account, or a collection-mode volunteer.
    account_id: Mapped[int | None] = mapped_column(index=True)
    participant_id: Mapped[int | None] = mapped_column(ForeignKey("participants.id"), index=True)
    modality: Mapped[str] = mapped_column(String(8))  # pointer | keys
    # enroll (during a trusted session) | evidence | collect (a volunteer's recording)
    purpose: Mapped[str] = mapped_column(String(10))
    feature_schema: Mapped[int]
    values_json: Mapped[str]
    # SHA-256 of the submitted events: an identical window is never accepted twice.
    digest: Mapped[str] = mapped_column(String(64))
    events_z: Mapped[bytes | None] = mapped_column(LargeBinary)
    duration_ms: Mapped[float]
    captured_at: Mapped[float] = mapped_column(default=now)

    __table_args__ = (
        Index("ix_passive_account_modality", "account_id", "modality", "purpose"),
        Index("ux_passive_account_digest", "account_id", "digest", unique=True),
        Index("ux_passive_participant_digest", "participant_id", "digest", unique=True),
    )


class SampleFeatures(Base):
    """Derived movement features for a sample. Preferred over raw trajectories for storage."""

    __tablename__ = "sample_features"

    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.id"), primary_key=True)
    feature_schema: Mapped[int]
    values_json: Mapped[str]


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
