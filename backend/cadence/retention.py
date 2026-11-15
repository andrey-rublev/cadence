"""Retention: what Cadence keeps, and for how long.

The profile is kept for as long as the account exists, because every check is scored against
it: the setup windows (`enroll`), sign-in typing (`login`), verified partner sign-ins
(`signin`) and enrollment rounds. Deleting the profile removes all of it at once.

Everything else is removed once it is older than `retention_days`:
- evidence windows, which only ever counted towards one check (for minutes, not days);
- raw recordings an account opted to keep, which are stripped and leave the measurements;
- verifications and partner-site checks, with the evidence and decisions they hold;
- expired codes, evidence tokens, grants and unused challenges.

Volunteer recordings from collection mode are not touched here. They are kept under the
volunteer consent and removed on request by username.

Run by hand with `uv run python -m cadence.retention`; the API also runs it on start-up and
every `retention_sweep_s` seconds.
"""

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .core.config import settings
from .core.models import (
    ActionGrant,
    Challenge,
    EvidenceToken,
    LinkCode,
    PassiveWindow,
    Sample,
    SiteCheck,
    TrustCode,
    Verification,
    now,
)

DAY_S = 86_400


def purge(db: Session, at: float | None = None) -> dict[str, int]:
    """Delete or strip everything past retention. Returns how many rows each step touched."""
    cutoff = (now() if at is None else at) - settings.retention_days * DAY_S
    steps = {
        "evidence_windows": delete(PassiveWindow).where(
            PassiveWindow.account_id.is_not(None),
            PassiveWindow.purpose == "evidence",
            PassiveWindow.captured_at < cutoff,
        ),
        "raw_windows": update(PassiveWindow)
        .where(
            PassiveWindow.account_id.is_not(None),
            PassiveWindow.events_z.is_not(None),
            PassiveWindow.captured_at < cutoff,
        )
        .values(events_z=None),
        "raw_rounds": update(Sample)
        .where(Sample.account_id.is_not(None), Sample.events_z.is_not(None), Sample.captured_at < cutoff)
        .values(events_z=None),
        "verifications": delete(Verification).where(Verification.updated_at < cutoff),
        "site_checks": delete(SiteCheck).where(SiteCheck.created_at < cutoff),
        "evidence_tokens": delete(EvidenceToken).where(EvidenceToken.expires_at < cutoff),
        "link_codes": delete(LinkCode).where(LinkCode.expires_at < cutoff),
        "trust_codes": delete(TrustCode).where(TrustCode.expires_at < cutoff),
        "grants": delete(ActionGrant).where(ActionGrant.expires_at < cutoff),
        # A challenge with a stored round is part of that round's record.
        "challenges": delete(Challenge).where(
            Challenge.expires_at < cutoff, Challenge.id.not_in(select(Sample.challenge_id))
        ),
    }
    counts = {name: db.execute(statement).rowcount for name, statement in steps.items()}
    db.commit()
    return counts


if __name__ == "__main__":
    from .core.db import SessionLocal, init_db

    init_db()
    with SessionLocal() as db:
        for name, count in purge(db).items():
            print(f"{name}: {count}")
