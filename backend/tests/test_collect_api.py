from fastapi.testclient import TestClient

from cadence.core.config import settings
from cadence.main import app

from .conftest import HEADERS, backdate_challenge, play, play_round, start_collect

META = {"scale": 1, "dpr": 1, "pointer_type": "mouse"}


def test_consent_is_required(client):
    assert start_collect(client, consent=False).status_code == 400


def test_state_changing_routes_need_the_client_header():
    with TestClient(app) as bare:
        body = {"consent": True, "username": "bare", "declared_device": "mouse", "station": "x"}
        r = bare.post("/api/collect/start", json=body)
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


def finish_session(client):
    for i in range(settings.collect_rounds + 1):
        play_round(client, seed=i)


def test_second_session_can_follow_straight_away(client):
    assert start_collect(client, username="MoleFan ").json()["username"] == "molefan"
    finish_session(client)
    with TestClient(app, headers=HEADERS) as again:
        second = start_collect(again, username="molefan", returning=True)
        assert second.status_code == 200 and second.json()["label"] == "B"


def test_usernames_must_be_simple(client):
    for bad in ("ab", "has space", "x" * 25, "-leading", "emoji✨"):
        r = start_collect(client, username=bad)
        assert r.status_code == 400 and r.json()["detail"] == "invalid_username", bad


def test_newcomer_cannot_join_someone_elses_recordings(client):
    start_collect(client, username="digger")
    finish_session(client)
    with TestClient(app, headers=HEADERS) as newcomer:
        r = start_collect(newcomer, username="Digger")
        assert r.status_code == 409 and r.json()["detail"] == "username_taken"


def test_abandoned_first_attempt_does_not_lock_the_username(client):
    start_collect(client, username="digger")
    with TestClient(app, headers=HEADERS) as retry:
        assert start_collect(retry, username="digger").json()["label"] == "A"


def test_returning_volunteer_with_a_typo_is_stopped(client):
    r = start_collect(client, username="diger", returning=True)
    assert r.status_code == 404 and r.json()["detail"] == "unknown_username"
    # ...unless they say their earlier session was on a different laptop.
    r = start_collect(client, username="diger", returning=True, earlier_session_elsewhere=True)
    assert r.status_code == 200 and r.json()["label"] == "A"


def test_split_depends_only_on_the_username_and_pilots_are_excluded(client):
    from cadence.collect import split_of

    names = [f"volunteer{i}" for i in range(12)]
    for name in names:
        with TestClient(app, headers=HEADERS) as c:
            start_collect(c, username=name)
    with TestClient(app, headers=HEADERS) as c:
        start_collect(c, username="teammate", is_pilot=True)

    expected = {"pilot": 1}
    for name in names:
        expected[split_of(name)] = expected.get(split_of(name), 0) + 1
    assert client.get("/api/collect/overview").json()["participants_by_split"] == expected
    assert set(expected) <= {"train", "validation", "test", "pilot"}


def test_database_from_the_code_era_is_migrated_in_place(tmp_path):
    from sqlalchemy import create_engine

    from cadence.core.db import migrate

    old = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with old.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE participants (id INTEGER PRIMARY KEY, code VARCHAR(16), split VARCHAR(12))")
        conn.exec_driver_sql("INSERT INTO participants (code, split) VALUES ('P-E3BPJ', 'pilot')")
    migrate(old)
    migrate(old)  # safe to run on every start
    with old.begin() as conn:
        assert conn.exec_driver_sql("SELECT username, split FROM participants").all() == [("p-e3bpj", "pilot")]


def test_status_is_null_without_a_session_and_live_with_one(client):
    assert client.get("/api/collect/status").json() is None
    started = start_collect(client).json()
    assert client.get("/api/collect/status").json() == started
