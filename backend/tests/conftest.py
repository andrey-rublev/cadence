import os
import random
import tempfile
from pathlib import Path

# Point the app at a throwaway database before any cadence module is imported.
_TMP = Path(tempfile.mkdtemp(prefix="cadence-test-"))
os.environ["CADENCE_DB_PATH"] = str(_TMP / "test.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import update  # noqa: E402

from cadence.core.db import Base, SessionLocal, engine  # noqa: E402
from cadence.core.models import Challenge, UserSession  # noqa: E402
from cadence.main import app  # noqa: E402
from cadence.synthetic import SyntheticProfile, simulate_round  # noqa: E402

HEADERS = {"X-Cadence-Client": "1"}


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def client():
    with TestClient(app, headers=HEADERS) as c:
        yield c


def start_collect(client: TestClient, **overrides):
    body = {"consent": True, "declared_device": "mouse", "station": "laptop-1"} | overrides
    return client.post("/api/collect/start", json=body)


def backdate_challenge(challenge_id: str, seconds: float = 60) -> None:
    """Pretend the challenge was issued a while ago, so a simulated round fits the server clock."""
    with SessionLocal() as db:
        db.execute(
            update(Challenge)
            .where(Challenge.id == challenge_id)
            .values(issued_at=Challenge.issued_at - seconds)
        )
        db.commit()


def end_collect_sessions_long_ago() -> None:
    with SessionLocal() as db:
        db.execute(update(UserSession).values(completed_at=UserSession.completed_at - 3600))
        db.commit()


def play(layout: dict, seed: int = 1) -> list:
    return simulate_round(layout, SyntheticProfile(), random.Random(seed))


def play_round(client: TestClient, seed: int = 1):
    """Issue a challenge, complete it with the synthetic player, submit it."""
    challenge = client.post("/api/challenges").json()
    backdate_challenge(challenge["id"])
    body = {"events": play(challenge["layout"], seed), "meta": {"scale": 1, "dpr": 1, "pointer_type": "mouse"}}
    return challenge, client.post(f"/api/challenges/{challenge['id']}/submit", json=body)
