"""Cadence as a second factor for another site: linking, evidence from the partner's page,
server-to-server checks, verifying another way, and learning from verified checks.

The keyboard models here are fitted on two SYNTHETIC typists: these tests check wiring and
enforcement, not how well real people are told apart.
"""

from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest
from fastapi.testclient import TestClient

from cadence.core.config import settings
from cadence.core.db import SessionLocal
from cadence.features.keys import KEY_FEATURE_NAMES, KEY_SCHEMA
from cadence.main import app
from cadence.verifier.artifact import load_active, save

from .conftest import HEADERS
from .test_passive_api import (  # noqa: F401  (keys_model is a fixture)
    OWNER,
    STRANGER,
    body,
    consented_client,
    enroll_two_sign_ins,
    finish_setup,
    keys_model,
    typing,
)

PARTNER = "http://localhost:5180"
REDIRECT = f"{PARTNER}/cadence/callback"
SECRET = {"Authorization": f"Bearer {settings.demo_site_secret}"}


@pytest.fixture
def site(keys_model):
    from cadence.api.sites import register_demo_site

    with SessionLocal() as db:
        register_demo_site(db)
    # The login-length model: the synthetic keyboard model reused, so short typing can be scored.
    model = load_active(settings.artifacts_dir / "keys", KEY_FEATURE_NAMES, KEY_SCHEMA)
    save(settings.artifacts_dir / "keys-login" / model.version, model, feature_names=KEY_FEATURE_NAMES, schema=KEY_SCHEMA)


def owner_with_profile(rng) -> TestClient:
    client = consented_client()
    enroll_two_sign_ins(client, rng)
    finish_setup()
    return client


def link(client: TestClient) -> str:
    connected = client.post(
        "/api/sites/connect",
        json={"site_key": settings.demo_site_key, "redirect_uri": REDIRECT, "state": "s1"},
        headers=HEADERS,
    )
    assert connected.status_code == 200
    query = parse_qs(urlparse(connected.json()["redirect"]).query)
    assert query["state"] == ["s1"]
    partner = TestClient(app)
    exchanged = partner.post("/v1/links/exchange", json={"code": query["code"][0]}, headers=SECRET)
    assert exchanged.status_code == 200 and exchanged.json()["cadence_username"] == "maya"
    again = partner.post("/v1/links/exchange", json={"code": query["code"][0]}, headers=SECRET)
    assert again.json()["detail"] == "code_already_used"
    return exchanged.json()["subject"]


def evidence(events: list, origin: str = PARTNER) -> TestClient:
    browser = TestClient(app)
    return browser.post(
        "/v1/evidence",
        json={"keys": events, "pointer": []},
        headers={"X-Cadence-Site": settings.demo_site_key, "Origin": origin},
    )


def check(subject: str, token: str | None, action: str = "sign_in") -> dict:
    return TestClient(app).post("/v1/checks", json={"subject": subject, "evidence": token, "action": action}, headers=SECRET).json()


def test_owner_signs_in_without_any_extra_step_and_it_is_learned(site):
    rng = np.random.default_rng(10)
    client = owner_with_profile(rng)
    subject = link(client)
    before = client.get("/api/me", headers=HEADERS).json()["passive"]["keys"]["windows"]

    token = evidence(typing(OWNER, rng, keys=60)).json()["token"]
    result = check(subject, token)
    assert result["outcome"] == "CONSISTENT" and result["resolved_by"] == "behavior" and result["verify_url"] is None
    after = client.get("/api/me", headers=HEADERS).json()["passive"]["keys"]["windows"]
    assert after == before + 1  # the verified sign-in now strengthens the profile

    assert TestClient(app).post("/v1/checks", json={"subject": subject, "evidence": token}, headers=SECRET).json()["detail"] == "evidence_already_used"


def test_sign_in_length_typing_uses_the_login_model(site):
    rng = np.random.default_rng(11)
    subject = link(owner_with_profile(rng))
    result = check(subject, evidence(typing(OWNER, rng, keys=25)).json()["token"])
    keys = next(p for p in result["parts"] if p["modality"] == "keys")
    assert keys["use"] == "login" and keys["amount"] == 25 and keys["score"] is not None


def test_a_stranger_is_sent_to_verify_and_a_personal_test_can_clear_the_owner(site):
    rng = np.random.default_rng(12)
    client = owner_with_profile(rng)
    subject = link(client)
    held = check(subject, evidence(typing(STRANGER, rng, keys=60)).json()["token"])
    assert held["outcome"] == "INCONSISTENT" and not held["resolved"] and held["verify_url"].endswith(held["check_id"])

    info = client.get(f"/api/stepup/{held['check_id']}", headers=HEADERS).json()
    assert info["recommendation"]["recommended"] == "keys" and info["tests_left"] == 2

    # The stranger's test fails; the owner's passes and resolves the check.
    stranger = client.post(f"/api/stepup/{held['check_id']}/test", json={"keys": typing(STRANGER, rng, keys=55)}, headers=HEADERS)
    assert stranger.json()["resolved"] is False and stranger.json()["tests_left"] == 1
    owner = client.post(f"/api/stepup/{held['check_id']}/test", json={"keys": typing(OWNER, rng, keys=55)}, headers=HEADERS)
    assert owner.json()["resolved"] is True
    assert check_status(held["check_id"])["resolved_by"] == "test"


def check_status(check_id: str) -> dict:
    return TestClient(app).get(f"/v1/checks/{check_id}", headers=SECRET).json()


def test_no_activity_is_never_a_pass_and_the_authenticator_resolves_it(site):
    rng = np.random.default_rng(13)
    client = owner_with_profile(rng)
    subject = link(client)
    result = check(subject, None)
    assert result["outcome"] == "INSUFFICIENT_EVIDENCE" and not result["resolved"]
    code = client.post(f"/api/stepup/{result['check_id']}/start", headers=HEADERS).json()["demo_code"]
    wrong = client.post(f"/api/stepup/{result['check_id']}/verify", json={"code": "000000" if code != "000000" else "111111"}, headers=HEADERS)
    assert wrong.status_code == 400
    assert client.post(f"/api/stepup/{result['check_id']}/verify", json={"code": code}, headers=HEADERS).json()["resolved"]
    assert check_status(result["check_id"])["resolved_by"] == "fallback"


def test_partner_calls_are_bound_to_the_site(site):
    rng = np.random.default_rng(14)
    subject = link(owner_with_profile(rng))
    assert evidence(typing(OWNER, rng), origin="https://evil.example").status_code == 403
    token = evidence(typing(OWNER, rng)).json()["token"]
    bad = TestClient(app).post("/v1/checks", json={"subject": subject, "evidence": token}, headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401
    assert check("not-a-subject", token).get("detail") == "subject_not_linked"
    replay = typing(OWNER, rng)
    assert evidence(replay).status_code == 200 and evidence(replay).status_code == 409


def test_disconnecting_stops_checks(site):
    rng = np.random.default_rng(15)
    client = owner_with_profile(rng)
    subject = link(client)
    link_id = client.get("/api/sites", headers=HEADERS).json()["sites"][0]["id"]
    assert client.delete(f"/api/sites/{link_id}", headers=HEADERS).json()["sites"] == []
    assert check(subject, evidence(typing(OWNER, rng)).json()["token"])["detail"] == "subject_not_linked"

