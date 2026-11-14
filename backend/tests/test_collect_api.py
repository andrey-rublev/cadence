from fastapi.testclient import TestClient

from cadence.core.config import settings
from cadence.main import app

from .conftest import (
    HEADERS,
    backdate_challenge,
    end_collect_sessions_long_ago,
    play,
    play_round,
    start_collect,
)

META = {"scale": 1, "dpr": 1, "pointer_type": "mouse"}


def test_consent_is_required(client):
    assert start_collect(client, consent=False).status_code == 400


def test_state_changing_routes_need_the_client_header():
    with TestClient(app) as bare:
        r = bare.post("/api/collect/start", json={"consent": True, "declared_device": "mouse", "station": "x"})
        assert r.status_code == 403


def test_challenges_need_a_session(client):
    assert client.post("/api/challenges").status_code == 401


def test_full_collection_session(client):
    status = start_collect(client).json()
    assert status["label"] == "A" and not status["warmup_done"]

    challenge, r = play_round(client)
    assert challenge["is_warmup"] and r.status_code == 200
    assert r.json()["collect"] == status | {"warmup_done": True}

    for i in range(settings.collect_rounds):
        challenge, r = play_round(client, seed=10 + i)
        assert not challenge["is_warmup"] and r.status_code == 200
    final = r.json()["collect"]
    assert final["complete"] and final["rounds_done"] == settings.collect_rounds
    assert client.post("/api/challenges").status_code == 409


def test_challenge_is_single_use(client):
    start_collect(client)
    challenge, first = play_round(client)
    assert first.status_code == 200
    again = client.post(
        f"/api/challenges/{challenge['id']}/submit",
        json={"events": play(challenge["layout"]), "meta": META},
    )
    assert again.status_code == 409


def test_rejected_submission_still_consumes_the_challenge(client):
    start_collect(client)
    challenge = client.post("/api/challenges").json()
    backdate_challenge(challenge["id"])
    url = f"/api/challenges/{challenge['id']}/submit"
    moves_only = [e for e in play(challenge["layout"]) if e[3] == 0]
    assert client.post(url, json={"events": moves_only, "meta": META}).status_code == 422
    assert client.post(url, json={"events": play(challenge["layout"]), "meta": META}).status_code == 409


def test_replaying_an_old_trajectory_on_a_fresh_challenge_fails(client):
    start_collect(client)
    old, _ = play_round(client)
    fresh = client.post("/api/challenges").json()
    backdate_challenge(fresh["id"])
    r = client.post(
        f"/api/challenges/{fresh['id']}/submit", json={"events": play(old["layout"]), "meta": META}
    )
    assert r.status_code == 422
    assert r.json()["detail"]["reason"].startswith("target_not_hit")


def test_challenge_cannot_be_used_from_another_session(client):
    start_collect(client)
    challenge = client.post("/api/challenges").json()
    with TestClient(app, headers=HEADERS) as other:
        start_collect(other)
        r = other.post(
            f"/api/challenges/{challenge['id']}/submit",
            json={"events": play(challenge["layout"]), "meta": META},
        )
        assert r.status_code == 403


def test_expired_challenge_is_rejected(client):
    start_collect(client)
    challenge = client.post("/api/challenges").json()
    backdate_challenge(challenge["id"])
    from sqlalchemy import update

    from cadence.core.db import SessionLocal
    from cadence.core.models import Challenge

    with SessionLocal() as db:
        db.execute(update(Challenge).values(expires_at=Challenge.expires_at - 10_000))
        db.commit()
    r = client.post(
        f"/api/challenges/{challenge['id']}/submit",
        json={"events": play(challenge["layout"]), "meta": META},
    )
    assert r.status_code == 410


def test_challenge_issuing_is_rate_limited(client):
    start_collect(client)
    codes = [client.post("/api/challenges").status_code for _ in range(settings.challenge_rate_collect + 1)]
    assert codes[-1] == 429 and set(codes[:-1]) == {200}


def test_second_session_needs_a_break_unless_the_device_changed(client):
    code = start_collect(client).json()["participant_code"]
    for i in range(settings.collect_rounds + 1):
        play_round(client, seed=i)

    with TestClient(app, headers=HEADERS) as later:
        too_soon = start_collect(later, participant_code=code)
        assert too_soon.status_code == 409 and too_soon.json()["detail"]["code"] == "too_soon"

        other_device = start_collect(later, participant_code=code, declared_device="trackpad")
        assert other_device.status_code == 200 and other_device.json()["label"] == "B"

    end_collect_sessions_long_ago()
    with TestClient(app, headers=HEADERS) as later:
        assert start_collect(later, participant_code=code.lower()).json()["label"] == "B"


def test_mistyped_participant_code_is_rejected(client):
    code = start_collect(client).json()["participant_code"]
    wrong_last = "A" if code[-1] != "A" else "B"
    assert start_collect(client, participant_code=code[:-1] + wrong_last).status_code == 404
    assert start_collect(client, participant_code="P-ZZZZ").status_code == 404


def test_code_issued_on_another_laptop_keeps_its_split(client):
    from cadence.collect import split_of
    from cadence.core.db import Base, engine

    code = start_collect(client).json()["participant_code"]
    Base.metadata.drop_all(engine)  # a different laptop: same salt, empty database
    Base.metadata.create_all(engine)
    with TestClient(app, headers=HEADERS) as other_laptop:
        assert start_collect(other_laptop, participant_code=code).json()["label"] == "A"
    splits = client.get("/api/collect/overview").json()["participants_by_split"]
    assert splits == {split_of(code): 1}


def test_split_assignment_is_balanced_and_pilots_are_excluded(client):
    for _ in range(10):
        with TestClient(app, headers=HEADERS) as c:
            start_collect(c)
    with TestClient(app, headers=HEADERS) as c:
        start_collect(c, is_pilot=True)
    splits = client.get("/api/collect/overview").json()["participants_by_split"]
    assert splits == {"train": 6, "validation": 2, "test": 2, "pilot": 1}


def test_status_is_null_without_a_session_and_live_with_one(client):
    assert client.get("/api/collect/status").json() is None
    started = start_collect(client).json()
    assert client.get("/api/collect/status").json() == started
