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
from cadence.features.keys import KEY_FEATURE_NAMES, KEY_SCHEMA, presses_from_events, window_vector, zone_of_code
from cadence.main import app
from cadence.verifier.artifact import Model, load_active, save
from cadence.verifier.baseline import Baseline

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
    # A synthetic login-length model: 30-key probes against a 50-key profile, with an unsure zone
    # in the middle of the gap between the two synthetic typists.
    rng = np.random.default_rng(2)
    profile = np.array([window_vector(presses_from_events(typing(OWNER, rng))) for _ in range(6)])
    probes = {
        name: np.array([window_vector(presses_from_events(typing(p, rng, keys=30))) for _ in range(20)])
        for name, p in (("owner", OWNER), ("stranger", STRANGER))
    }
    verifier = Baseline.fit(np.vstack([profile, *probes.values()]))
    owner, stranger = (verifier.score_many(profile, p) for p in probes.values())
    low, gap = float(stranger.max()), float(owner.min() - stranger.max())
    assert gap > 0
    model = Model("keys-login-test", verifier, low + gap / 4, low + 3 * gap / 4, "synthetic", {"version": "keys-login-test", "limitations": []})
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


def test_delete_can_be_verified_from_the_two_word_confirmation(site):
    rng = np.random.default_rng(16)
    subject = link(owner_with_profile(rng))
    zones = [zone_of_code("Space" if char == " " else f"Key{char.upper()}") for char in "delete northwind"]

    full_phrase = evidence(typing(OWNER, rng, keys=len(zones), zones=zones)).json()["token"]
    result = check(subject, full_phrase, action="delete_account")
    keys = next(p for p in result["parts"] if p["modality"] == "keys")
    assert keys["use"] == "login" and keys["amount"] == len(zones)
    assert result["resolved_by"] == "behavior" and result["verify_url"] is None

    first_word = evidence(typing(OWNER, rng, keys=6, zones=zones)).json()["token"]
    result = check(subject, first_word, action="delete_account")
    assert result["outcome"] == "INSUFFICIENT_EVIDENCE" and result["verify_url"]


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


@pytest.fixture
def history(site):
    """A synthetic history model: distance to earlier 30-key sign-ins, with its threshold set on
    the combined score (as the real one is), halfway between the owner's and the stranger's."""
    rng = np.random.default_rng(1)
    short = lambda p: window_vector(presses_from_events(typing(p, rng, keys=30)))  # noqa: E731
    login = load_active(settings.artifacts_dir / "keys-login", KEY_FEATURE_NAMES, KEY_SCHEMA)
    profile = np.array([window_vector(presses_from_events(typing(OWNER, rng))) for _ in range(6)])
    earlier = np.array([short(OWNER) for _ in range(3)])
    probes = {name: np.array([short(p) for _ in range(12)]) for name, p in (("owner", OWNER), ("stranger", STRANGER))}
    verifier = Baseline.fit(np.vstack([earlier, *probes.values()]))
    combined = {
        name: (login.verifier.score_many(profile, p) + verifier.score_many(earlier, p)) / 2 for name, p in probes.items()
    }
    cut = float((np.median(combined["owner"]) + np.median(combined["stranger"])) / 2)
    model = Model("keys-history-test", verifier, cut, cut, "synthetic", {"version": "keys-history-test", "limitations": []})
    save(settings.artifacts_dir / "keys-history" / model.version, model, feature_names=KEY_FEATURE_NAMES, schema=KEY_SCHEMA)


def resolve(client: TestClient, result: dict) -> None:
    """Settle a check that was not released, with the (simulated) authenticator."""
    if result["resolved"]:
        return
    code = client.post(f"/api/stepup/{result['check_id']}/start", headers=HEADERS).json()["demo_code"]
    assert client.post(f"/api/stepup/{result['check_id']}/verify", json={"code": code}, headers=HEADERS).json()["resolved"]


def test_sign_ins_are_compared_with_earlier_sign_ins_on_the_same_site(history):
    rng = np.random.default_rng(16)
    client = owner_with_profile(rng)
    subject = link(client)
    # An export with sign-in length typing is not a sign-in, so it is never remembered as one.
    resolve(client, check(subject, evidence(typing(OWNER, rng, keys=30)).json()["token"], action="export_customers"))
    remembered = lambda: client.get("/api/sites", headers=HEADERS).json()["sites"][0]["sign_ins_remembered"]  # noqa: E731
    assert remembered() == 0

    for n in range(settings.history_min_sign_ins):
        result = check(subject, evidence(typing(OWNER, rng, keys=30)).json()["token"])
        keys = next(p for p in result["parts"] if p["modality"] == "keys")
        assert keys["earlier_sign_ins"] == 0 and keys["history_model_version"] is None
        assert result["outcome"] != "INCONSISTENT"
        resolve(client, result)
        assert remembered() == n + 1

    result = check(subject, evidence(typing(OWNER, rng, keys=30)).json()["token"])
    keys = next(p for p in result["parts"] if p["modality"] == "keys")
    assert keys["earlier_sign_ins"] == settings.history_min_sign_ins and keys["history_model_version"] is not None
    assert result["outcome"] == "CONSISTENT"

    stranger = check(subject, evidence(typing(STRANGER, rng, keys=30)).json()["token"])
    keys = next(p for p in stranger["parts"] if p["modality"] == "keys")
    assert keys["earlier_sign_ins"] == settings.history_min_sign_ins + 1 and stranger["outcome"] == "INCONSISTENT"
    # Confirmed with the authenticator, but it looked like someone else: not remembered.
    resolve(client, stranger)
    assert remembered() == settings.history_min_sign_ins + 1


def test_a_test_sentence_is_not_remembered_as_a_sign_in(history):
    rng = np.random.default_rng(17)
    client = owner_with_profile(rng)
    subject = link(client)
    held = check(subject, evidence(typing(STRANGER, rng, keys=30)).json()["token"])
    assert held["outcome"] == "INCONSISTENT"
    passed = client.post(f"/api/stepup/{held['check_id']}/test", json={"keys": typing(OWNER, rng, keys=30)}, headers=HEADERS)
    if passed.json()["resolved"]:
        assert client.get("/api/sites", headers=HEADERS).json()["sites"][0]["sign_ins_remembered"] == 0


def practice(subject: str, events: list) -> TestClient:
    token = evidence(events).json()["token"]
    return TestClient(app).post("/v1/sign-in-samples", json={"subject": subject, "evidence": token}, headers=SECRET)


def test_a_practice_sign_in_past_the_login_models_length_is_still_a_sign_in(history):
    """A long email and password, or a few corrections, is more keys than the login model takes."""
    rng = np.random.default_rng(19)
    client = owner_with_profile(rng)
    subject = link(client)
    added = practice(subject, typing(OWNER, rng, keys=settings.long_window_keys + 1)).json()
    assert added["accepted"] is True and added["samples"] == 1
    turned = practice(subject, typing(STRANGER, rng, keys=settings.long_window_keys + 1)).json()
    assert turned["accepted"] is False and turned["reason"] == "did_not_match" and turned["samples"] == 1


def test_practice_sign_ins_after_connecting_teach_this_sites_sign_in(history, monkeypatch):
    rng = np.random.default_rng(18)
    client = owner_with_profile(rng)
    subject = link(client)
    status = TestClient(app).post("/v1/sign-in-samples/status", json={"subject": subject}, headers=SECRET).json()
    assert status["samples"] == 0 and status["open"] and not status["complete"]

    # Someone else typing the password is turned away, and it still uses up an attempt.
    turned = practice(subject, typing(STRANGER, rng, keys=30)).json()
    assert turned["accepted"] is False and turned["reason"] == "did_not_match" and turned["samples"] == 0
    assert practice(subject, typing(OWNER, rng, keys=8)).json()["reason"] == "too_little_typing"

    for n in range(settings.history_min_sign_ins):
        added = practice(subject, typing(OWNER, rng, keys=30)).json()
        assert added["accepted"] is True and added["samples"] == n + 1
    assert added["complete"] is True

    # The very next sign-in is compared with the practice sign-ins.
    result = check(subject, evidence(typing(OWNER, rng, keys=30)).json()["token"])
    keys = next(p for p in result["parts"] if p["modality"] == "keys")
    assert keys["earlier_sign_ins"] == settings.history_min_sign_ins and result["outcome"] == "CONSISTENT"

    monkeypatch.setattr(settings, "practice_ttl_s", -1)
    assert practice(subject, typing(OWNER, rng, keys=30)).json()["detail"] == "practice_closed"

    link_id = client.get("/api/sites", headers=HEADERS).json()["sites"][0]["id"]
    client.delete(f"/api/sites/{link_id}", headers=HEADERS)
    with SessionLocal() as db:
        from cadence.core.models import PassiveWindow

        assert db.query(PassiveWindow).filter(PassiveWindow.purpose == "signin").count() == 0


def test_practice_needs_a_finished_setup(history):
    rng = np.random.default_rng(19)
    client = consented_client()
    enroll_two_sign_ins(client, rng)
    subject = link(client)
    assert practice(subject, typing(OWNER, rng, keys=30)).json()["detail"] == "setup_incomplete"
