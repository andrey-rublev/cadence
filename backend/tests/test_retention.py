"""Retention: the profile stays until it is deleted, everything else goes after retention_days."""

from sqlalchemy import func, select

from cadence.core.config import settings
from cadence.core.db import SessionLocal
from cadence.core.models import (
    Account,
    Challenge,
    EvidenceToken,
    Participant,
    PassiveWindow,
    Sample,
    Site,
    SiteCheck,
    UserSession,
    Verification,
    now,
)
from cadence.retention import DAY_S, purge

OLD = now() - (settings.retention_days + 1) * DAY_S
RECENT = now() - DAY_S


def _window(session_id: int, purpose: str, at: float, *, account_id=None, participant_id=None, raw=True):
    return PassiveWindow(
        session_id=session_id,
        account_id=account_id,
        participant_id=participant_id,
        modality="keys",
        purpose=purpose,
        feature_schema=1,
        values_json="[]",
        digest=f"{purpose}-{at}-{account_id}-{participant_id}",
        events_z=b"raw" if raw else None,
        duration_ms=1000,
        captured_at=at,
    )


def _seed(db) -> tuple[int, int]:
    account = Account(username="maya", password_hash="x", consent_at=OLD)
    volunteer = Participant(username="vol", split="train", consent_raw_at=OLD)
    db.add_all([account, volunteer, Site(id="s", name="S", site_key="k", secret_hash="h", origins_json="[]", redirect_uris_json="[]")])
    db.flush()
    session = UserSession(token_hash="t", kind="app", account_id=account.id, expires_at=OLD)
    db.add(session)
    db.flush()
    sid = session.id
    db.add_all(
        [
            # Profile: kept however old, raw recording stripped once past retention.
            *(_window(sid, p, OLD, account_id=account.id) for p in ("enroll", "login", "signin")),
            # Evidence: gone once past retention, kept while recent.
            _window(sid, "evidence", OLD, account_id=account.id),
            _window(sid, "evidence", RECENT, account_id=account.id),
            # Volunteer recording: untouched.
            _window(sid, "collect", OLD, participant_id=volunteer.id),
            Verification(id="v-old", session_id=sid, account_id=account.id, action="a", decision_json="{}", updated_at=OLD),
            Verification(id="v-new", session_id=sid, account_id=account.id, action="a", decision_json="{}", updated_at=RECENT),
            SiteCheck(id="c-old", site_id="s", account_id=account.id, action="a", decision_json="{}", windows_json="[]", created_at=OLD, expires_at=OLD),
            SiteCheck(id="c-new", site_id="s", account_id=account.id, action="a", decision_json="{}", windows_json="[]", created_at=RECENT, expires_at=RECENT),
            EvidenceToken(token_hash="e", site_id="s", windows_json="[]", keys=0, strokes=0, digest="d", expires_at=OLD),
            Challenge(id="ch-used", session_id=sid, purpose="enroll", task_version=1, seed=1, layout_json="{}", expires_at=OLD),
            Challenge(id="ch-unused", session_id=sid, purpose="verify", task_version=1, seed=1, layout_json="{}", expires_at=OLD),
        ]
    )
    db.flush()
    db.add(
        Sample(
            challenge_id="ch-used", session_id=sid, account_id=account.id, purpose="enroll", source="account",
            task_version=1, events_z=b"raw", timeline_json="[]", meta_json="{}", captured_at=OLD,
        )
    )
    db.commit()
    return account.id, volunteer.id


def test_purge_keeps_the_profile_and_removes_the_rest():
    with SessionLocal() as db:
        account_id, volunteer_id = _seed(db)
        purge(db)

        purposes = sorted(db.scalars(select(PassiveWindow.purpose).where(PassiveWindow.account_id == account_id)))
        assert purposes == ["enroll", "evidence", "login", "signin"]  # the one evidence left is the recent one
        assert db.scalar(
            select(func.count()).where(PassiveWindow.account_id == account_id, PassiveWindow.events_z.is_not(None))
        ) == 1  # only the recent evidence window still has its raw events

        collect = db.scalar(select(PassiveWindow).where(PassiveWindow.participant_id == volunteer_id))
        assert collect is not None and collect.events_z == b"raw"

        sample = db.scalar(select(Sample))
        assert sample is not None and sample.events_z is None  # the round stays, its raw recording goes

        assert list(db.scalars(select(Verification.id))) == ["v-new"]
        assert list(db.scalars(select(SiteCheck.id))) == ["c-new"]
        assert db.scalar(select(func.count()).select_from(EvidenceToken)) == 0
        assert list(db.scalars(select(Challenge.id))) == ["ch-used"]


def test_purge_is_idempotent():
    with SessionLocal() as db:
        _seed(db)
        purge(db)
        assert all(count == 0 for count in purge(db).values())
