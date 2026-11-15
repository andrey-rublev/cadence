"""Northwind CRM, a FICTIONAL company that uses Cadence the way a real customer would.

It runs as its own service with its own users, passwords and database. It knows Cadence only
through the public site key (in the browser) and the site secret (here, on the server):

- sign-in: password first, then `POST /v1/checks` with the evidence token the browser got
  from Cadence. Released: signed in. Otherwise the person is sent to Cadence to verify,
  and comes back to `/cadence/return`, where this server reads the check again.
- export: the same, with action `export_customers`. An export is a request: which customers,
  which fields, a name and a written reason, all kept in the export log. Building one takes
  a fair amount of clicking and typing, which is what Cadence gets to look at. Once an export
  has been verified, more exports in the same web session go through for a few minutes
  without asking again (EXPORT_GRACE_S), unless the typing on the page clearly isn't the
  account owner's.
- deleting an account: a fresh `delete_account` check for a connected account, followed by
  removal of the account, its sessions, and its export history.
- linking: "Protect with Cadence" sends the person to Cadence /connect; the code that comes
  back is exchanged here for an opaque subject. Then the person types their Northwind sign-in
  a few times (`/api/cadence/practice`): the password is checked here, and Cadence receives
  only the browser's timing token, so later sign-ins are compared with exactly that typing.

Run: uv run --project backend uvicorn partner_demo.main:app --port 8100
"""

import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlencode

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import ForeignKey, String, create_engine, delete, event, inspect, select, text, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .data import CUSTOMERS

CADENCE_API = os.environ.get("NORTHWIND_CADENCE_API", "http://127.0.0.1:8000")
CADENCE_WEB = os.environ.get("NORTHWIND_CADENCE_WEB", "http://localhost:5173")
SITE_KEY = os.environ.get("NORTHWIND_SITE_KEY", "pk_demo_northwind")
SITE_SECRET = os.environ.get("NORTHWIND_SITE_SECRET", "sk_demo_northwind_local_only")  # local demo value
WEB = os.environ.get("NORTHWIND_WEB", "http://localhost:5180")
DB_PATH = Path(os.environ.get("NORTHWIND_DB_PATH", Path(__file__).resolve().parents[1] / "northwind.db"))
COOKIE = "northwind_session"
PENDING_COOKIE = "northwind_pending"
SESSION_TTL_S = 8 * 3600
PENDING_TTL_S = 900
# After a verified export, further exports in the same web session need no new check for this
# long. The window starts at the verification and is not stretched by the exports it lets through.
EXPORT_GRACE_S = int(os.environ.get("NORTHWIND_EXPORT_GRACE_S", 5 * 60))


# ---------------------------------------------------------------- storage


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    cadence_subject: Mapped[str | None] = mapped_column(String(64))  # opaque; set once linked
    cadence_since: Mapped[float | None]


class WebSession(Base):
    __tablename__ = "web_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[float]
    last_check_json: Mapped[str | None]  # the Cadence check that let this sign-in through
    export_trusted_until: Mapped[float | None]  # exports need no new check until then


class Pending(Base):
    """An action waiting for the person to verify with Cadence."""

    __tablename__ = "pending"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(12))  # sign_in | export | delete
    check_id: Mapped[str] = mapped_column(String(32))
    browser_hash: Mapped[str] = mapped_column(String(64))  # binds it to the browser that started it
    created_at: Mapped[float]
    done_at: Mapped[float | None]


class ExportRequest(Base):
    """One export someone asked for: what, why, and whether it was released. The export log."""

    __tablename__ = "export_requests"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    reason: Mapped[str] = mapped_column(String(600))
    audience: Mapped[str] = mapped_column(String(12))  # me | team | external
    recipient: Mapped[str | None] = mapped_column(String(120))  # who, when it leaves Northwind
    customer_ids_json: Mapped[str]
    fields_json: Mapped[str]
    created_at: Mapped[float]
    pending_id: Mapped[str | None] = mapped_column(String(32), index=True)  # waiting for Cadence
    released_at: Mapped[float | None]
    released_by: Mapped[str | None] = mapped_column(String(12))  # behavior | test | fallback | recent | password


class ConnectState(Base):
    __tablename__ = "connect_states"
    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[float]


engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def enable_foreign_keys(connection, _record) -> None:
    # Requests finishing after an account is deleted cannot recreate its dependent records.
    connection.execute("PRAGMA foreign_keys=ON")


Base.metadata.create_all(engine)
with engine.begin() as conn:  # databases made before the export grace window existed
    if "export_trusted_until" not in {c["name"] for c in inspect(conn).get_columns("web_sessions")}:
        conn.execute(text("ALTER TABLE web_sessions ADD COLUMN export_trusted_until FLOAT"))
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


Db = Annotated[Session, Depends(get_db)]


def sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$")
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(candidate.hex(), digest)


# ---------------------------------------------------------------- Cadence client (server to server)


def cadence(method: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{CADENCE_API}{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={"Authorization": f"Bearer {SITE_SECRET}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = json.loads(error.read() or b"{}").get("detail", error.code)
        raise HTTPException(502 if error.code >= 500 else 400, f"cadence:{detail}") from None
    except urllib.error.URLError:
        raise HTTPException(503, "cadence_unreachable") from None


def summary(check: dict) -> dict:
    """What Northwind shows about a Cadence check: the outcome and how sure, never raw data."""
    return {
        "check_id": check["check_id"],
        "outcome": check["outcome"],
        "reason": check["reason"],
        "resolved_by": check["resolved_by"],
        "parts": [
            {
                k: p.get(k)
                for k in ("modality", "outcome", "score", "accept_at", "reject_at", "use", "amount", "earlier_sign_ins")
            }
            for p in check["parts"]
        ],
    }


# ---------------------------------------------------------------- web sessions


app = FastAPI(title="Northwind CRM (fictional Cadence partner)")


def require_header(x_northwind: Annotated[str | None, Header()] = None) -> None:
    if x_northwind != "1":
        raise HTTPException(403, "missing_client_header")


def open_session(db: Session, response: Response, user: User, check: dict | None) -> WebSession:
    token = secrets.token_urlsafe(32)
    web = WebSession(
        token_hash=sha(token),
        user_id=user.id,
        expires_at=time.time() + SESSION_TTL_S,
        last_check_json=json.dumps(summary(check)) if check else None,
    )
    db.add(web)
    db.commit()
    response.set_cookie(COOKIE, token, max_age=SESSION_TTL_S, httponly=True, samesite="lax", path="/")
    return web


def current(db: Db, token: Annotated[str | None, Cookie(alias=COOKIE)] = None) -> tuple[User, WebSession]:
    web = db.get(WebSession, sha(token)) if token else None
    if web is None or web.expires_at < time.time():
        raise HTTPException(401, "not_signed_in")
    user = db.get(User, web.user_id)
    if user is None:
        raise HTTPException(401, "not_signed_in")
    return user, web


Current = Annotated[tuple[User, WebSession], Depends(current)]


def me_view(user: User, web: WebSession | None = None) -> dict:
    return {
        "email": user.email,
        "cadence": {"connected": user.cadence_subject is not None, "since": user.cadence_since},
        "sign_in_check": json.loads(web.last_check_json) if web and web.last_check_json else None,
    }


def start_pending(
    db: Session, response: Response, user: User, kind: str, check: dict, *, binding: str = ""
) -> dict:
    browser = secrets.token_urlsafe(24)
    pending = Pending(
        id=secrets.token_hex(16),
        user_id=user.id,
        kind=kind,
        check_id=check["check_id"],
        browser_hash=sha(browser + binding),
        created_at=time.time(),
    )
    db.add(pending)
    db.commit()
    response.set_cookie(PENDING_COOKIE, browser, max_age=PENDING_TTL_S, httponly=True, samesite="lax", path="/")
    back = f"{WEB}/cadence/return?{urlencode({'pending': pending.id})}"
    return {
        "status": "verify",
        "pending": pending.id,
        "verify_url": f"{check['verify_url']}?{urlencode({'return_to': back})}",
        "check": summary(check),
    }


def verified_pending(
    db: Session, pending_id: str, kind: str, browser: str | None, *, binding: str = ""
) -> tuple[Pending, dict]:
    pending = db.get(Pending, pending_id)
    if (
        pending is None
        or pending.kind != kind
        or pending.done_at is not None
        or pending.created_at + PENDING_TTL_S < time.time()
    ):
        raise HTTPException(400, "pending_unknown")
    if not browser or not hmac.compare_digest(pending.browser_hash, sha(browser + binding)):
        raise HTTPException(403, "pending_other_browser")
    check = cadence("GET", f"/v1/checks/{pending.check_id}")
    if not check["resolved"]:
        raise HTTPException(403, "not_verified")
    return pending, check


def finish_pending(db: Session, pending_id: str, kind: str, browser: str | None) -> tuple[User, dict]:
    pending, check = verified_pending(db, pending_id, kind, browser)
    user = db.get(User, pending.user_id)
    if user is None:
        raise HTTPException(400, "pending_unknown")
    pending.done_at = time.time()
    db.commit()
    return user, check


# ---------------------------------------------------------------- routes


api = Depends(require_header)


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=200)
    evidence: str | None = Field(default=None, max_length=64)  # Cadence evidence token from the browser


@app.post("/api/register", dependencies=[api])
def register(body: Credentials, response: Response, db: Db) -> dict:
    email = body.email.strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "email_taken")
    # SQLite can reuse a deleted rowid. Give new accounts independent IDs so requests in
    # flight for a deleted account can never attach to the next registration.
    user = User(id=secrets.randbits(63), email=email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    open_session(db, response, user, None)
    return {"status": "signed_in", "me": me_view(user)}


@app.post("/api/login", dependencies=[api])
def login(body: Credentials, response: Response, db: Db) -> dict:
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user is None or not check_password(body.password, user.password_hash):
        raise HTTPException(401, "invalid_credentials")
    if user.cadence_subject is None:
        open_session(db, response, user, None)  # password only: this account has not turned Cadence on
        return {"status": "signed_in", "me": me_view(user)}
    check = cadence("POST", "/v1/checks", {"subject": user.cadence_subject, "evidence": body.evidence, "action": "sign_in"})
    if check["resolved"]:
        web = open_session(db, response, user, check)
        return {"status": "signed_in", "me": me_view(user, web), "check": summary(check)}
    return start_pending(db, response, user, "sign_in", check)


class PendingBody(BaseModel):
    pending: str = Field(max_length=32)


def login_finish(
    body: PendingBody, response: Response, db: Db, browser: Annotated[str | None, Cookie(alias=PENDING_COOKIE)] = None
) -> dict:
    user, check = finish_pending(db, body.pending, "sign_in", browser)
    web = open_session(db, response, user, check)
    return {"status": "signed_in", "kind": "sign_in", "me": me_view(user, web), "check": summary(check)}


@app.get("/api/me", dependencies=[api])
def me(db: Db, token: Annotated[str | None, Cookie(alias=COOKIE)] = None) -> dict | None:
    try:
        user, web = current(db, token)
    except HTTPException:
        return None
    return me_view(user, web)


@app.post("/api/logout", dependencies=[api])
def logout(response: Response, session: Current, db: Db) -> dict:
    _, web = session
    web.expires_at = time.time()
    db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.post("/api/cadence/connect", dependencies=[api])
def cadence_connect(session: Current, db: Db) -> dict:
    user, _ = session
    state = secrets.token_urlsafe(24)
    db.add(ConnectState(state=state, user_id=user.id, expires_at=time.time() + 600))
    db.commit()
    query = urlencode({"site_key": SITE_KEY, "redirect_uri": f"{WEB}/cadence/callback", "state": state})
    return {"url": f"{CADENCE_WEB}/connect?{query}"}


class CallbackBody(BaseModel):
    code: str = Field(max_length=64)
    state: str = Field(max_length=64)


@app.post("/api/cadence/callback", dependencies=[api])
def cadence_callback(body: CallbackBody, session: Current, db: Db) -> dict:
    user, web = session
    state = db.get(ConnectState, body.state)
    if state is None or state.user_id != user.id or state.expires_at < time.time():
        raise HTTPException(400, "state_invalid")
    db.delete(state)
    linked = cadence("POST", "/v1/links/exchange", {"code": body.code})
    user.cadence_subject, user.cadence_since = linked["subject"], time.time()
    db.commit()
    return me_view(user, web)


def linked_subject(user: User) -> str:
    if user.cadence_subject is None:
        raise HTTPException(409, "cadence_not_connected")
    return user.cadence_subject


@app.get("/api/cadence/practice", dependencies=[api])
def cadence_practice_status(session: Current) -> dict:
    """How many practice sign-ins Cadence has, and whether it still takes more."""
    user, _ = session
    return cadence("POST", "/v1/sign-in-samples/status", {"subject": linked_subject(user)})


@app.post("/api/cadence/practice", dependencies=[api])
def cadence_practice(body: Credentials, session: Current) -> dict:
    """A practice sign-in right after connecting. The password is checked here, as at sign-in;
    only the browser's evidence token goes to Cadence, so Cadence never sees the password."""
    user, _ = session
    subject = linked_subject(user)
    if body.email.strip().lower() != user.email or not check_password(body.password, user.password_hash):
        raise HTTPException(400, "practice_wrong_credentials")
    if body.evidence is None:
        raise HTTPException(400, "practice_no_typing")
    return cadence("POST", "/v1/sign-in-samples", {"subject": subject, "evidence": body.evidence})


@app.post("/api/cadence/disconnect", dependencies=[api])
def cadence_disconnect(session: Current, db: Db) -> dict:
    user, web = session
    user.cadence_subject = user.cadence_since = None
    db.commit()
    return me_view(user, web)


@app.get("/api/customers", dependencies=[api])
def customers(session: Current) -> dict:
    return {"fictional": True, "customers": CUSTOMERS}


# What an export may contain, in file order. The contact fields are personal data.
EXPORT_FIELDS = ("id", "company", "plan", "seats", "since", "contact", "email", "phone")
CUSTOMER_IDS = {c["id"] for c in CUSTOMERS}


class ExportBody(BaseModel):
    evidence: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=3, max_length=80)
    reason: str = Field(max_length=600)
    audience: Literal["me", "team", "external"]
    recipient: str | None = Field(default=None, max_length=120)
    customer_ids: list[str] = Field(min_length=1, max_length=len(CUSTOMERS))
    fields: list[str] = Field(min_length=1, max_length=len(EXPORT_FIELDS))
    acknowledged: Literal[True]  # the data handling statement was ticked

    @field_validator("name", "recipient")
    @classmethod
    def _trimmed(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("reason")
    @classmethod
    def _written_reason(cls, value: str) -> str:
        reason = value.strip()
        if not reason:
            raise ValueError("reason_required")
        return reason

    @field_validator("customer_ids")
    @classmethod
    def _known_customers(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or not set(value) <= CUSTOMER_IDS:
            raise ValueError("unknown_customer")
        return value

    @field_validator("fields")
    @classmethod
    def _known_fields(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or not set(value) <= set(EXPORT_FIELDS):
            raise ValueError("unknown_field")
        return [f for f in EXPORT_FIELDS if f in value]  # file order, whatever order they were ticked in

    @model_validator(mode="after")
    def _recipient_when_external(self) -> "ExportBody":
        if self.audience == "external" and not self.recipient:
            raise ValueError("recipient_required")
        if self.audience != "external":
            self.recipient = None
        return self


def trust_exports(db: Session, web: WebSession) -> None:
    """A verified export: let more exports in this web session through for a while."""
    web.export_trusted_until = time.time() + EXPORT_GRACE_S
    db.commit()


def export_trusted(web: WebSession) -> bool:
    return web.export_trusted_until is not None and web.export_trusted_until > time.time()


def export_view(request: ExportRequest) -> dict:
    """A line of the export log."""
    return {
        "id": request.id,
        "name": request.name,
        "reason": request.reason,
        "audience": request.audience,
        "recipient": request.recipient,
        "records": len(json.loads(request.customer_ids_json)),
        "fields": json.loads(request.fields_json),
        "created_at": request.created_at,
        "released_at": request.released_at,
        "released_by": request.released_by,
    }


def released(db: Session, request: ExportRequest, web: WebSession, check: dict | None, by: str) -> dict:
    """Record the release and hand over exactly the rows and fields that were asked for."""
    request.released_at, request.released_by, request.pending_id = time.time(), by, None
    db.add(request)
    db.commit()
    ids, fields = set(json.loads(request.customer_ids_json)), json.loads(request.fields_json)
    return {
        "status": "released",
        "export": export_view(request) | {"rows": [{f: c[f] for f in fields} for c in CUSTOMERS if c["id"] in ids]},
        "check": summary(check) if check else None,
        "trusted_until": web.export_trusted_until if export_trusted(web) else None,
    }


@app.get("/api/exports", dependencies=[api])
def exports(session: Current, db: Db) -> dict:
    """This person's export log, newest first, including requests that were never released."""
    user, _ = session
    rows = db.scalars(
        select(ExportRequest).where(ExportRequest.user_id == user.id).order_by(ExportRequest.created_at.desc()).limit(50)
    ).all()
    return {"exports": [export_view(r) for r in rows]}


@app.post("/api/export", dependencies=[api])
def export(body: ExportBody, response: Response, session: Current, db: Db) -> dict:
    """Sensitive: needs Cadence to agree (or the person to verify) when Cadence is on.

    Within the grace window after a verified export, the page's typing is still sent when
    there is any: a check that says it isn't the owner ends the window and asks again, while
    "too little to tell" or "unsure" is covered by the recent verification.
    """
    user, web = session
    request = ExportRequest(
        id=secrets.token_hex(16),
        user_id=user.id,
        name=body.name,
        reason=body.reason,
        audience=body.audience,
        recipient=body.recipient,
        customer_ids_json=json.dumps(body.customer_ids),
        fields_json=json.dumps(body.fields),
        created_at=time.time(),
    )
    if user.cadence_subject is None:
        return released(db, request, web, None, "password")
    trusted = export_trusted(web)
    if trusted and body.evidence is None:
        return released(db, request, web, None, "recent")
    check = cadence(
        "POST", "/v1/checks", {"subject": user.cadence_subject, "evidence": body.evidence, "action": "export_customers"}
    )
    if check["resolved"]:
        trust_exports(db, web)
        return released(db, request, web, check, check["resolved_by"])
    if trusted and check["outcome"] != "INCONSISTENT":
        return released(db, request, web, None, "recent")
    if trusted:
        web.export_trusted_until = None
    out = start_pending(db, response, user, "export", check)
    request.pending_id = out["pending"]
    db.add(request)
    db.commit()
    return out


class DeleteAccountBody(BaseModel):
    confirmation: Literal["delete northwind"]
    evidence: str | None = Field(default=None, max_length=64)


def deletion_binding(user: User, web: WebSession) -> str:
    return f":{web.token_hash}:{user.cadence_subject}:{user.cadence_since}"


def delete_account_data(db: Session, response: Response, user: User, web: WebSession) -> dict:
    # Claim the account and check that the session and Cadence connection survived verification.
    active_session = select(WebSession.token_hash).where(
        WebSession.token_hash == web.token_hash, WebSession.user_id == user.id, WebSession.expires_at > time.time()
    ).exists()
    claimed = db.execute(
        update(User)
        .where(
            User.id == user.id,
            User.cadence_subject == user.cadence_subject,
            User.cadence_since == user.cadence_since,
            active_session,
        )
        .values(cadence_subject=None)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        raise HTTPException(409, "deletion_session_changed")
    for model in (ExportRequest, Pending, ConnectState, WebSession):
        db.execute(delete(model).where(model.user_id == user.id))
    db.delete(user)
    db.commit()
    response.delete_cookie(COOKIE, path="/")
    response.delete_cookie(PENDING_COOKIE, path="/")
    return {"status": "deleted", "kind": "delete"}


@app.post("/api/account/delete", dependencies=[api])
def delete_account(body: DeleteAccountBody, response: Response, session: Current, db: Db) -> dict:
    user, web = session
    check = cadence(
        "POST", "/v1/checks", {"subject": linked_subject(user), "evidence": body.evidence, "action": "delete_account"}
    )
    if check["resolved"]:
        return delete_account_data(db, response, user, web)
    return start_pending(db, response, user, "delete", check, binding=deletion_binding(user, web))


@app.post("/api/finish", dependencies=[api])
def finish(
    body: PendingBody,
    response: Response,
    db: Db,
    browser: Annotated[str | None, Cookie(alias=PENDING_COOKIE)] = None,
    token: Annotated[str | None, Cookie(alias=COOKIE)] = None,
) -> dict:
    """Back from Cadence: finish the action that was waiting."""
    pending = db.get(Pending, body.pending)
    if pending is None:
        raise HTTPException(400, "pending_unknown")
    if pending.kind == "sign_in":
        return login_finish(body, response, db, browser)
    user, web = current(db, token)
    if user.id != pending.user_id:
        raise HTTPException(403, "pending_other_user")
    if pending.kind == "delete":
        linked_subject(user)
        verified_pending(db, body.pending, "delete", browser, binding=deletion_binding(user, web))
        return delete_account_data(db, response, user, web)
    _, check = finish_pending(db, body.pending, "export", browser)
    request = db.scalar(select(ExportRequest).where(ExportRequest.pending_id == pending.id))
    if request is None:
        raise HTTPException(400, "pending_unknown")
    trust_exports(db, web)
    return {"kind": "export", **released(db, request, web, check, check["resolved_by"])}


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "site_key": SITE_KEY}
