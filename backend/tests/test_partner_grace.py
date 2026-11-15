"""Northwind's exports: a logged request for chosen rows and fields, and the grace window in
which one verification covers the next few minutes of exports."""

import os
import tempfile
from pathlib import Path

os.environ.setdefault("NORTHWIND_DB_PATH", str(Path(tempfile.mkdtemp(prefix="northwind-test-")) / "nw.db"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select, update  # noqa: E402

from partner_demo import main as nw  # noqa: E402


class FakeCadence:
    """Stands in for Cadence's partner API: each new check gets the next queued outcome."""

    def __init__(self) -> None:
        self.outcomes: list[str] = []
        self.checks: dict[str, dict] = {}
        self.posted = 0
        self.last_action: str | None = None

    def __call__(self, method: str, path: str, body: dict | None = None) -> dict:
        if method == "POST" and path == "/v1/checks":
            self.posted += 1
            self.last_action = body["action"]
            outcome = self.outcomes.pop(0)
            check_id = f"c{len(self.checks)}"
            self.checks[check_id] = {
                "check_id": check_id,
                "outcome": outcome,
                "reason": None,
                "parts": [],
                "resolved": outcome == "CONSISTENT",
                "resolved_by": "behavior" if outcome == "CONSISTENT" else None,
                "verify_url": f"http://cadence.test/verify/{check_id}",
            }
            return self.checks[check_id]
        if method == "GET" and path.startswith("/v1/checks/"):
            return self.checks[path.rsplit("/", 1)[1]]
        raise AssertionError(f"unexpected Cadence call {method} {path}")

    def pass_test(self, check_id: str) -> None:
        self.checks[check_id] |= {"resolved": True, "resolved_by": "test"}


@pytest.fixture
def fake(monkeypatch):
    fake = FakeCadence()
    monkeypatch.setattr(nw, "cadence", fake)
    return fake


@pytest.fixture
def client(fake):
    nw.Base.metadata.drop_all(nw.engine)
    nw.Base.metadata.create_all(nw.engine)
    with TestClient(nw.app, headers={"X-Northwind": "1"}) as c:
        c.post("/api/register", json={"email": "ada@northwind.test", "password": "correct horse"})
        with nw.SessionLocal() as db:
            db.execute(update(nw.User).values(cadence_subject="sub_1", cadence_since=0.0))
            db.commit()
        yield c


SPEC = {
    "name": "Spring renewals",
    "reason": "Renewal calls",
    "audience": "team",
    "customer_ids": ["C-1063", "C-1042"],
    "fields": ["email", "company"],
    "acknowledged": True,
}
DELETE = {"confirmation": "delete northwind"}


def verify_export(client: TestClient, fake: FakeCadence) -> dict:
    """Export, get sent to Cadence, pass the typing test, come back."""
    fake.outcomes.append("INSUFFICIENT_EVIDENCE")
    out = client.post("/api/export", json=SPEC | {"evidence": "tok"}).json()
    assert out["status"] == "verify"
    fake.pass_test(out["check"]["check_id"])
    return client.post("/api/finish", json={"pending": out["pending"]}).json()


def test_export_after_verifying_does_not_ask_again(client, fake):
    back = verify_export(client, fake)
    assert back["status"] == "released" and back["trusted_until"]

    fake.outcomes.append("INSUFFICIENT_EVIDENCE")  # a click or two: too little to judge
    again = client.post("/api/export", json=SPEC | {"evidence": "tok"}).json()
    assert again["status"] == "released"
    assert again["check"] is None and again["trusted_until"] == back["trusted_until"]


def test_export_without_evidence_in_window_skips_cadence(client, fake):
    verify_export(client, fake)
    before = fake.posted
    assert client.post("/api/export", json=SPEC | {"evidence": None}).json()["status"] == "released"
    assert fake.posted == before


def test_typing_that_is_not_the_owner_ends_the_window(client, fake):
    verify_export(client, fake)
    fake.outcomes.append("INCONSISTENT")
    assert client.post("/api/export", json=SPEC | {"evidence": "tok"}).json()["status"] == "verify"

    fake.outcomes.append("INSUFFICIENT_EVIDENCE")
    assert client.post("/api/export", json=SPEC | {"evidence": "tok"}).json()["status"] == "verify"


def test_window_expires(client, fake):
    verify_export(client, fake)
    with nw.SessionLocal() as db:
        db.execute(update(nw.WebSession).values(export_trusted_until=0.0))
        db.commit()
    fake.outcomes.append("INSUFFICIENT_EVIDENCE")
    assert client.post("/api/export", json=SPEC | {"evidence": "tok"}).json()["status"] == "verify"


def test_window_belongs_to_one_web_session(client, fake):
    verify_export(client, fake)
    with TestClient(nw.app, headers={"X-Northwind": "1"}) as other:
        # Signing in elsewhere goes through Cadence too; let that sign-in pass.
        fake.outcomes.append("CONSISTENT")
        signed_in = other.post("/api/login", json={"email": "ada@northwind.test", "password": "correct horse"})
        assert signed_in.json()["status"] == "signed_in"
        fake.outcomes.append("INSUFFICIENT_EVIDENCE")
        assert other.post("/api/export", json=SPEC | {"evidence": "tok"}).json()["status"] == "verify"


def test_no_grace_before_any_verification(client, fake):
    fake.outcomes.append("INSUFFICIENT_EVIDENCE")
    assert client.post("/api/export", json=SPEC | {"evidence": "tok"}).json()["status"] == "verify"


def test_export_hands_over_only_what_was_asked_for(client, fake):
    fake.outcomes.append("CONSISTENT")
    out = client.post("/api/export", json=SPEC | {"evidence": "tok"}).json()
    assert out["status"] == "released"
    assert out["export"]["rows"] == [  # file order, not the order they were picked in
        {"company": "Quillfeather Bindery", "email": "odalys@quillfeather.example.com"},
        {"company": "Hollow Pine Outfitters", "email": "sunniva@hollowpine.example.com"},
    ]


def test_export_accepts_and_logs_a_short_reason(client, fake):
    fake.outcomes.append("CONSISTENT")
    response = client.post("/api/export", json=SPEC | {"evidence": "tok", "reason": "  x  "})

    assert response.status_code == 200
    assert response.json()["status"] == "released"
    assert client.get("/api/exports").json()["exports"][0]["reason"] == "x"


def test_log_keeps_requests_that_were_not_released(client, fake):
    fake.outcomes.append("INSUFFICIENT_EVIDENCE")
    waiting = client.post("/api/export", json=SPEC | {"evidence": "tok", "name": "Never verified"}).json()
    assert waiting["status"] == "verify"
    fake.outcomes.append("CONSISTENT")
    client.post("/api/export", json=SPEC | {"evidence": "tok"})

    log = client.get("/api/exports").json()["exports"]
    assert [(e["name"], e["released_by"]) for e in log] == [("Spring renewals", "behavior"), ("Never verified", None)]
    assert log[0]["reason"] == "Renewal calls"
    assert log[0]["records"] == 2 and log[0]["fields"] == ["company", "email"]

    fake.pass_test(waiting["check"]["check_id"])
    back = client.post("/api/finish", json={"pending": waiting["pending"]}).json()
    assert back["export"]["name"] == "Never verified" and back["export"]["released_by"] == "test"


@pytest.mark.parametrize(
    "change",
    [
        {"reason": "  "},
        {"name": "  "},
        {"customer_ids": []},
        {"customer_ids": ["C-0000"]},
        {"fields": ["password_hash"]},
        {"audience": "external"},  # leaving Northwind needs a named recipient
        {"acknowledged": False},
    ],
)
def test_incomplete_requests_are_refused(client, fake, change):
    assert client.post("/api/export", json=SPEC | {"evidence": "tok"} | change).status_code == 422
    assert client.get("/api/exports").json()["exports"] == []


def test_password_only_account_exports_are_logged_too(client, fake):
    with nw.SessionLocal() as db:
        db.execute(update(nw.User).values(cadence_subject=None))
        db.commit()
    out = client.post("/api/export", json=SPEC | {"evidence": None}).json()
    assert out["status"] == "released" and out["export"]["released_by"] == "password"


def test_delete_requires_confirmation_and_cadence_connection(client, fake):
    for body in ({}, {"confirmed": True}, {"confirmation": "delete"}):
        assert client.post("/api/account/delete", json=body).status_code == 422
    assert client.post("/api/cadence/disconnect").status_code == 200
    response = client.post("/api/account/delete", json=DELETE)
    assert response.status_code == 409
    assert response.json()["detail"] == "cadence_not_connected"
    assert fake.posted == 0
    assert client.get("/api/me").json()["email"] == "ada@northwind.test"


def test_delete_needs_its_own_check_and_finishes_in_the_starting_session(client, fake):
    verify_export(client, fake)
    assert client.post("/api/cadence/connect").status_code == 200

    fake.outcomes.append("INSUFFICIENT_EVIDENCE")
    out = client.post("/api/account/delete", json=DELETE).json()
    assert out["status"] == "verify"
    assert fake.last_action == "delete_account"
    finish = {"pending": out["pending"]}
    assert client.post("/api/finish", json=finish).json()["detail"] == "not_verified"
    assert len(client.get("/api/exports").json()["exports"]) == 1

    fake.pass_test(out["check"]["check_id"])
    with TestClient(nw.app, headers={"X-Northwind": "1"}) as other:
        fake.outcomes.append("CONSISTENT")
        assert other.post("/api/login", json={"email": "ada@northwind.test", "password": "correct horse"}).status_code == 200
        other.cookies.set(nw.PENDING_COOKIE, client.cookies.get(nw.PENDING_COOKIE))
        assert other.post("/api/finish", json=finish).status_code == 403

        assert client.post("/api/finish", json=finish).json() == {"status": "deleted", "kind": "delete"}
        assert client.get("/api/me").json() is None
        assert other.get("/api/me").json() is None

    assert client.post("/api/finish", json=finish).status_code == 400
    with nw.SessionLocal() as db:
        for model in (nw.User, nw.ExportRequest, nw.Pending, nw.ConnectState, nw.WebSession):
            assert db.scalar(select(model)) is None


def test_delete_can_complete_with_behavior_and_preserves_other_accounts(client, fake):
    with TestClient(nw.app, headers={"X-Northwind": "1"}) as other:
        assert other.post("/api/register", json={"email": "grace@northwind.test", "password": "correct horse"}).status_code == 200
        fake.outcomes.append("CONSISTENT")
        response = client.post("/api/account/delete", json=DELETE | {"evidence": "tok"})
        assert response.json() == {"status": "deleted", "kind": "delete"}
        assert fake.last_action == "delete_account"
        assert client.get("/api/me").json() is None
        assert other.get("/api/me").json()["email"] == "grace@northwind.test"
        assert client.post("/api/register", json={"email": "ada@northwind.test", "password": "new password"}).status_code == 200
