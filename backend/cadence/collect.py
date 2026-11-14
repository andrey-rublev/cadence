"""Collection mode: consenting volunteers, pseudonymous codes, blind split assignment."""

import hashlib
import random
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .api.schemas import CollectStatus
from .core.config import settings
from .core.models import Participant, Sample, UserSession

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
SPLIT_BLOCK = ("train", "train", "train", "validation", "test")


def _digest(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest(), 16)


def split_of(code: str) -> str:
    """The split is a pure function of the code, so every collection laptop agrees on it."""
    return SPLIT_BLOCK[_digest(f"{settings.split_salt}:{code}") % len(SPLIT_BLOCK)]


def _check_char(body: str) -> str:
    return CODE_ALPHABET[_digest(f"check:{body}") % len(CODE_ALPHABET)]


def is_valid_code(code: str) -> bool:
    """Codes look like P-ABCDE; the last character is a checksum that catches typos."""
    body = code[2:6]
    return (
        len(code) == 7
        and code.startswith("P-")
        and all(c in CODE_ALPHABET for c in body)
        and code[6] == _check_char(body)
    )


def _next_split(db: Session) -> str:
    """Blocked random assignment: every five consecutive volunteers give 3 train, 1 validation, 1 test.

    The order inside each block comes from a salted hash, so it is fixed before any
    data exists and nobody can steer a volunteer into a split.
    """
    n = db.scalar(select(func.count()).select_from(Participant).where(Participant.is_pilot.is_(False)))
    block, position = divmod(n, len(SPLIT_BLOCK))
    order = list(SPLIT_BLOCK)
    random.Random(_digest(f"{settings.split_salt}:block:{block}")).shuffle(order)
    return order[position]


def new_code(db: Session) -> str:
    """A fresh code whose hash lands in the split this volunteer is due for."""
    target = _next_split(db)
    while True:
        body = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))
        code = f"P-{body}{_check_char(body)}"
        taken = db.scalar(select(Participant.id).where(Participant.code == code))
        if split_of(code) == target and not taken:
            return code


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
        participant_code=participant.code,
        label=session.label or "",
        warmup_done=counts.get(True, 0) > 0,
        rounds_done=done,
        rounds_total=settings.collect_rounds,
        complete=done >= settings.collect_rounds,
    )
