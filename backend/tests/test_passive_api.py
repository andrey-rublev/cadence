"""Passive checks: windows of ordinary use enroll during a trusted session, count as evidence
otherwise, and decide the protected export without any challenge.

The keyboard model here is fitted on two SYNTHETIC typists. These tests check wiring and
enforcement, not how well real people are told apart.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from cadence.core.config import settings
from cadence.features.keys import KEY_FEATURE_NAMES, KEY_SCHEMA, presses_from_events, window_vector
from cadence.main import app
from cadence.verifier.artifact import Model, save
from cadence.verifier.baseline import Baseline

from .conftest import HEADERS

PASSWORD = "test-only-passphrase"
ZONES = [3, 7, 2, 6, 9, 3, 8, 4, 6, 9, 2, 7, 3, 10, 5, 9]  # a mix of hands, rows, spaces, one backspace
OWNER = {"hold": 85, "dd": 135}
STRANGER = {"hold": 150, "dd": 260}


def typing(profile: dict, rng: np.random.Generator, keys: int = 50) -> list[list[float]]:
    events, t = [], 0.0
    for i in range(keys):
        zone = ZONES[i % len(ZONES)]
        hold = max(30.0, rng.normal(profile["hold"], 12))
        events += [[round(t, 1), 1, zone], [round(t + hold, 1), 2, zone]]
        t += max(40.0, rng.normal(profile["dd"], 25))
    return sorted(events, key=lambda e: e[0])


def body(events: list) -> dict:
    return {"modality": "keys", "events": events, "duration_ms": events[-1][0]}


@pytest.fixture
def keys_model(tmp_path, monkeypatch):
    rng = np.random.default_rng(0)
    vectors = {
        name: [window_vector(presses_from_events(typing(p, rng))) for _ in range(12)]
        for name, p in (("owner", OWNER), ("stranger", STRANGER))
    }
    verifier = Baseline.fit(np.array(vectors["owner"] + vectors["stranger"]))
    template = np.array(vectors["owner"][:6])
    genuine = verifier.score_many(template, np.array(vectors["owner"][6:]))
    impostor = verifier.score_many(template, np.array(vectors["stranger"]))
    cut = float((genuine.min() + impostor.max()) / 2)
    model = Model("keys-test", verifier, cut, cut, "synthetic", {"version": "keys-test", "limitations": []})
    save(tmp_path / "keys" / "keys-test", model, feature_names=KEY_FEATURE_NAMES, schema=KEY_SCHEMA)
    monkeypatch.setattr(settings, "artifacts_dir", tmp_path)
    monkeypatch.setattr(settings, "allow_synthetic_model", True)
    # Windows in these tests are sent faster than they could be typed; the clock rule has its own test.
    monkeypatch.setattr(settings, "passive_clock_slack_ms", 10**9)


def sign_in(client: TestClient, name: str = "maya", register: bool = False) -> None:
    path = "/api/auth/register" if register else "/api/auth/login"
    assert client.post(path, json={"username": name, "password": PASSWORD}, headers=HEADERS).status_code == 200


def trust(client: TestClient) -> None:
    code = client.post("/api/trust/start", headers=HEADERS).json()["demo_code"]
    assert client.post("/api/trust/verify", json={"code": code}, headers=HEADERS).status_code == 200


def consented_client() -> TestClient:
    client = TestClient(app)
    sign_in(client, register=True)
    assert client.post("/api/consent", json={"agree": True}, headers=HEADERS).status_code == 200
    return client


def enroll_two_sign_ins(client: TestClient, rng) -> None:
    for sign_in_round in range(2):
        if sign_in_round:
            sign_in(client)
        trust(client)
        for _ in range(3):
            assert client.post("/api/passive", json=body(typing(OWNER, rng)), headers=HEADERS).json()["purpose"] == "enroll"


def authorize(client: TestClient) -> dict:
    return client.post("/api/actions/export_customers/authorize", headers=HEADERS).json()


def test_consent_is_required(keys_model):
    client = TestClient(app)
    sign_in(client, register=True)
    response = client.post("/api/passive", json=body(typing(OWNER, np.random.default_rng(1))), headers=HEADERS)
    assert response.status_code == 403 and response.json()["detail"] == "consent_required"


def test_untrusted_windows_are_evidence_not_enrollment(keys_model):
    client = consented_client()
    result = client.post("/api/passive", json=body(typing(OWNER, np.random.default_rng(1))), headers=HEADERS).json()
    assert result["purpose"] == "evidence"
    assert result["passive"]["keys"]["windows"] == 0 and result["passive"]["keys"]["recent_evidence"] == 1


def test_an_identical_window_is_rejected(keys_model):
    client = consented_client()
    window = body(typing(OWNER, np.random.default_rng(1)))
    assert client.post("/api/passive", json=window, headers=HEADERS).status_code == 200
    replay = client.post("/api/passive", json=window, headers=HEADERS)
    assert replay.status_code == 409 and replay.json()["detail"] == "window_already_used"


def test_a_window_longer_than_the_server_has_seen_is_rejected(keys_model, monkeypatch):
    monkeypatch.setattr(settings, "passive_clock_slack_ms", 2000)
    client = consented_client()
    response = client.post("/api/passive", json=body(typing(OWNER, np.random.default_rng(1))), headers=HEADERS)
    assert response.status_code == 422 and response.json()["detail"] == "client_clock_ahead_of_server"


def test_malformed_and_thin_windows_are_rejected(keys_model):
    client = consented_client()
    events = typing(OWNER, np.random.default_rng(1), keys=10)
    assert client.post("/api/passive", json=body(events), headers=HEADERS).json()["detail"] == "too_little_typing"
    backwards = typing(OWNER, np.random.default_rng(2))
    backwards[5][0] = -1
    assert client.post("/api/passive", json={**body(backwards), "duration_ms": backwards[-1][0]}, headers=HEADERS).status_code == 422


def test_a_learning_sign_in_is_not_checked_against_itself(keys_model):
    rng = np.random.default_rng(4)
    client = consented_client()
    enroll_two_sign_ins(client, rng)  # still inside the second, trusted sign-in
    client.post("/api/passive", json=body(typing(OWNER, rng)), headers=HEADERS)
    decision = authorize(client)
    assert decision["grant"] is None
    assert decision["decision"]["outcome"] == "INSUFFICIENT_EVIDENCE"
    assert decision["decision"]["reason"] == "learning_session"


def test_owner_is_released_without_a_challenge_and_a_stranger_is_held(keys_model):
    rng = np.random.default_rng(3)
    client = consented_client()
    enroll_two_sign_ins(client, rng)

    sign_in(client)  # a fresh, untrusted session
    assert authorize(client)["decision"]["reason"] == "no_interaction_yet"
    client.post("/api/passive", json=body(typing(OWNER, rng)), headers=HEADERS)
    opened = authorize(client)
    keys = next(p for p in opened["decision"]["parts"] if p["modality"] == "keys")
    assert opened["decision"]["outcome"] == "CONSISTENT" and keys["outcome"] == "CONSISTENT"
    assert client.post("/api/export", json={"grant": opened["grant"]}, headers=HEADERS).status_code == 200

    sign_in(client)  # someone else at the same account
    for _ in range(2):
        client.post("/api/passive", json=body(typing(STRANGER, rng)), headers=HEADERS)
    held = authorize(client)
    assert held["decision"]["outcome"] == "INCONSISTENT" and held["grant"] is None
    assert client.post("/api/export", json={"grant": "made-up"}, headers=HEADERS).status_code == 403


def test_deleting_the_profile_removes_passive_windows(keys_model):
    rng = np.random.default_rng(4)
    client = consented_client()
    enroll_two_sign_ins(client, rng)
    me = client.delete("/api/profile", headers=HEADERS).json()
    assert me["passive"]["keys"]["windows"] == 0 and me["consent"] is False
