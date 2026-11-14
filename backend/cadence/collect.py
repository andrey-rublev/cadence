"""Collection mode: consenting volunteers, self-chosen usernames, blind split assignment."""

import hashlib
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .api.schemas import CollectStatus
from .core.config import settings
from .core.models import Participant, Sample, UserSession

SPLITS = ("train", "train", "train", "validation", "test")
USERNAME = re.compile(r"[a-z0-9][a-z0-9._-]{2,23}")


def normalise_username(raw: str) -> str | None:
    """Lower-cased, trimmed username, or None if it is not 3-24 letters, digits, dots, dashes or underscores."""
    username = raw.strip().lower()
    return username if USERNAME.fullmatch(username) else None


def split_of(username: str) -> str:
    """The split is a pure function of the username, so every collection laptop agrees on it.

    About 60/20/20 in expectation. With few volunteers the counts can be lopsided; the
    export step may rebalance over the merged set as long as it stays blind to the data.
    """
    digest = hashlib.sha256(f"{settings.split_salt}:{username}".encode()).hexdigest()
    return SPLITS[int(digest, 16) % len(SPLITS)]


def collect_status(db: Session, session: UserSession) -> CollectStatus:
    counts = dict(
        db.execute(
            select(Sample.is_warmup, func.count())
            .where(Sample.session_id == session.id)
            .group_by(Sample.is_warmup)
        ).all()
    )
    participant = db.get(Participant, session.participant_id)
    done = counts.get(False, 0)
    return CollectStatus(
        username=participant.username,
        label=session.label or "",
        warmup_done=counts.get(True, 0) > 0,
        rounds_done=done,
        rounds_total=settings.collect_rounds,
        complete=done >= settings.collect_rounds,
    )
