"""The product loop: sign-in, trusted enrollment, verification, and the protected export.

The verifier here is trained on SYNTHETIC players. These tests check that the loop is
wired and enforced correctly; they say nothing about how well real people are told apart.
"""

import random

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from cadence.core.config import settings
from cadence.core.db import SessionLocal
from cadence.core.models import ActionGrant
from cadence.main import app
from cadence.synthetic import SyntheticProfile, simulate_round
from cadence.verifier.artifact import save
from cadence.verifier.training import synthetic_rounds, train

from .conftest import HEADERS, backdate_challenge

PASSWORD = "test-only-passphrase"
META = {"scale": 1, "dpr": 1, "pointer_type": "mouse"}
OWNER = SyntheticProfile(
    fitts_a_ms=105, fitts_b_ms=125, reaction_ms=220, hold_ms=75, curve_px=4,
    aim_spread=0.2, track_lag_ms=100, track_noise_px=2,
)  # fmt: skip
STRANGER = SyntheticProfile(
    fitts_a_ms=188, fitts_b_ms=208, reaction_ms=375, hold_ms=148, curve_px=-13,
    aim_spread=0.48, track_lag_ms=236, track_noise_px=5.8,
)  # fmt: skip


@pytest.fixture(scope="module")
def synthetic_model(tmp_path_factory):
    # B0 only and a short bootstrap: these tests are about the API, not model selection.
    model, _ = train(synthetic_rounds(25, seed=3), "synthetic", candidates=("b0",), reps=50)
    assert model is not None
    directory = tmp_path_factory.mktemp("models")
    save(directory / model.version, model)
    return directory


@pytest.fixture
def no_model(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "artifacts_dir", tmp_path)


@pytest.fixture
def model(synthetic_model, monkeypatch):
    monkeypatch.setattr(settings, "artifacts_dir", synthetic_model)
    monkeypatch.setattr(settings, "allow_synthetic_model", True)


def credentials(name="maya"):
    return {"username": name, "password": PASSWORD}


def trust(client, verification_id=None):
    code = client.post("/api/trust/start").json()["demo_code"]
    return client.post("/api/trust/verify", json={"code": code, "verification_id": verification_id})


def play_round(client, purpose, profile, seed, verification_id=None):
    issued = client.post("/api/challenges", json={"purpose": purpose, "verification_id": verification_id})
    assert issued.status_code == 200, issued.json()
    challenge = issued.json()
    backdate_challenge(challenge["id"])
    events = simulate_round(challenge["layout"], profile, random.Random(seed))
    return client.post(f"/api/challenges/{challenge['id']}/submit", json={"events": events, "meta": META})


def enroll_session(client, profile, seed):
    for i in range(settings.enroll_rounds_per_session + 1):  # one practice round first
        result = play_round(client, "enroll", profile, seed + i)
        assert result.status_code == 200, result.json()
    return result.json()["profile"]


def enrolled_owner(client):
    client.post("/api/auth/register", json=credentials())
    client.post("/api/consent", json={"agree": True})
    trust(client)
    first = enroll_session(client, OWNER, seed=100)
    assert not first["sufficient"]  # one session is never enough
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json=credentials())
    trust(client)
    second = enroll_session(client, OWNER, seed=200)
    assert second["sufficient"] and second["sessions"] == 2
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json=credentials())


def verify(client, profile, seed=900):
    """Run verification rounds until the attempt resolves or rounds run out."""
    opened = client.post("/api/actions/export_customers/authorize?method=challenge").json()
    result = {"decision": opened["decision"], "grant": None}
    for i in range(settings.verify_max_rounds):
        result = play_round(client, "verify", profile, seed + i, opened["verification_id"]).json()
        if result["decision"]["outcome"] != "UNCERTAIN":
            break
    return opened["verification_id"], result


def test_sign_up_sign_in_and_out(client):
    assert client.get("/api/me").json() is None
    assert client.post("/api/auth/register", json=credentials("Maya")).json()["username"] == "maya"
    assert client.post("/api/auth/register", json=credentials()).status_code == 409
    client.post("/api/auth/logout")
    assert client.get("/api/me").json() is None
    assert client.post("/api/auth/login", json={"username": "maya", "password": "wrong-password"}).status_code == 401
    assert client.post("/api/auth/login", json=credentials("nobody")).status_code == 401
    me = client.post("/api/auth/login", json=credentials()).json()
    assert me["username"] == "maya" and not me["trusted"] and not me["consent"]


def test_enrollment_needs_consent_then_trusted_verification(client, no_model):
    client.post("/api/auth/register", json=credentials())
    body = {"purpose": "enroll"}
    assert client.post("/api/challenges", json=body).json()["detail"] == "consent_required"
    client.post("/api/consent", json={"agree": True})
    assert client.post("/api/challenges", json=body).json()["detail"] == "trusted_verification_required"
    assert trust(client).json()["trusted"]
    profile = enroll_session(client, OWNER, seed=1)
    assert profile["rounds"] == settings.enroll_rounds_per_session and profile["sessions"] == 1
    assert client.post("/api/challenges", json=body).json()["detail"] == "enrollment_session_complete"


def test_wrong_fallback_code_is_refused_and_attempts_are_limited(client):
    client.post("/api/auth/register", json=credentials())
    code = client.post("/api/trust/start").json()["demo_code"]
    wrong = f"{(int(code) + 1) % 10**6:06d}"
    for _ in range(5):
        assert client.post("/api/trust/verify", json={"code": wrong}).json()["detail"] == "code_incorrect"
    assert client.post("/api/trust/verify", json={"code": code}).json()["detail"] == "code_expired"
    assert not client.get("/api/me").json()["trusted"]


def test_export_is_refused_without_a_grant(client, model):
    enrolled_owner(client)
    assert client.get("/api/customers").status_code == 200  # viewing is not the protected action
    for grant in ("", "made-up-grant"):
        assert client.post("/api/export", json={"grant": grant}).status_code == 403


def test_missing_model_never_approves_but_fallback_still_works(client, no_model):
    enrolled_owner(client)
    opened = client.post("/api/actions/export_customers/authorize?method=challenge").json()
    assert opened["decision"]["outcome"] == "INSUFFICIENT_EVIDENCE"
    assert opened["decision"]["reason"] == "model_missing"
    played = play_round(client, "verify", OWNER, 1, opened["verification_id"]).json()
    assert played["decision"]["outcome"] == "INSUFFICIENT_EVIDENCE" and played["grant"] is None

    grant = trust(client, opened["verification_id"]).json()["grant"]
    exported = client.post("/api/export", json={"grant": grant})
    assert exported.status_code == 200 and exported.json()["basis"] == "fallback"


def test_account_without_a_profile_gets_insufficient_evidence_not_a_mismatch(client, model):
    client.post("/api/auth/register", json=credentials())
    decision = client.post("/api/actions/export_customers/authorize?method=challenge").json()["decision"]
    assert decision["outcome"] == "INSUFFICIENT_EVIDENCE" and decision["reason"] == "not_enrolled"


def test_owner_is_consistent_and_the_grant_is_single_use_and_session_bound(client, model):
    enrolled_owner(client)
    _, result = verify(client, OWNER)
    assert result["decision"]["outcome"] == "CONSISTENT", result["decision"]
    assert result["decision"]["score"] > result["decision"]["accept_at"]

    with TestClient(app, headers=HEADERS) as elsewhere:
        elsewhere.post("/api/auth/login", json=credentials())
        assert elsewhere.post("/api/export", json={"grant": result["grant"]}).status_code == 403

    assert client.post("/api/export", json={"grant": result["grant"]}).json()["basis"] == "behavior"
    again = client.post("/api/export", json={"grant": result["grant"]})
    assert again.status_code == 403 and again.json()["detail"] == "grant_already_used"


def test_stranger_is_held_until_trusted_verification(client, model):
    enrolled_owner(client)
    before = client.get("/api/me").json()["profile"]["rounds"]
    verification_id, result = verify(client, STRANGER)
    assert result["decision"]["outcome"] == "INCONSISTENT", result["decision"]
    assert result["grant"] is None
    # The stranger's rounds must not leak into the owner's profile.
    assert client.get("/api/me").json()["profile"]["rounds"] == before

    grant = trust(client, verification_id).json()["grant"]
    assert client.post("/api/export", json={"grant": grant}).status_code == 200
    # A resolved verification cannot be reused for another grant.
    assert trust(client, verification_id).json()["grant"] is None


def test_grant_expires(client, model):
    enrolled_owner(client)
    _, result = verify(client, OWNER)
    with SessionLocal() as db:
        db.execute(update(ActionGrant).values(expires_at=ActionGrant.expires_at - 10_000))
        db.commit()
    expired = client.post("/api/export", json={"grant": result["grant"]})
    assert expired.status_code == 403 and expired.json()["detail"] == "grant_expired"


def test_verification_challenges_are_rate_limited(client, model):
    enrolled_owner(client)
    verification_id = client.post("/api/actions/export_customers/authorize?method=challenge").json()["verification_id"]
    body = {"purpose": "verify", "verification_id": verification_id}
    codes = [client.post("/api/challenges", json=body).status_code for _ in range(settings.challenge_rate_verify + 1)]
    assert codes == [200] * settings.challenge_rate_verify + [429]


def test_deleting_the_profile_needs_trust_and_removes_everything(client, model):
    enrolled_owner(client)
    assert client.delete("/api/profile").json()["detail"] == "trusted_verification_required"
    trust(client)
    me = client.delete("/api/profile").json()
    assert me["profile"]["rounds"] == 0 and not me["consent"]
    decision = client.post("/api/actions/export_customers/authorize?method=challenge").json()["decision"]
    assert decision["reason"] == "not_enrolled"
