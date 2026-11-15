"""Northwind CRM, a FICTIONAL company that uses Cadence the way a real customer would.

It runs as its own service with its own users, passwords and database. It knows Cadence only
through the public site key (in the browser) and the site secret (here, on the server):

- sign-in: password first, then `POST /v1/checks` with the evidence token the browser got
  from Cadence. Released: signed in. Otherwise the person is sent to Cadence to verify,
  and comes back to `/cadence/return`, where this server reads the check again.
- export: the same, with action `export_customers`.
- linking: "Protect with Cadence" sends the person to Cadence /connect; the code that comes
  back is exchanged here for an opaque subject.

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
from typing import Annotated
from urllib.parse import urlencode

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, String, create_engine, select
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


class Pending(Base):
    """A sign-in or export waiting for the person to verify with Cadence."""

    __tablename__ = "pending"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(12))  # sign_in | export
    check_id: Mapped[str] = mapped_column(String(32))
    browser_hash: Mapped[str] = mapped_column(String(64))  # binds it to the browser that started it
    created_at: Mapped[float]
    done_at: Mapped[float | None]


class ConnectState(Base):
    __tablename__ = "connect_states"
    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[float]


engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)
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
            {k: p.get(k) for k in ("modality", "outcome", "score", "accept_at", "reject_at", "use", "amount")}
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
    return db.get(User, web.user_id), web


Current = Annotated[tuple[User, WebSession], Depends(current)]


def me_view(user: User, web: WebSession | None = None) -> dict:
    return {
        "email": user.email,
        "cadence": {"connected": user.cadence_subject is not None, "since": user.cadence_since},
        "sign_in_check": json.loads(web.last_check_json) if web and web.last_check_json else None,
    }


def start_pending(db: Session, response: Response, user: User, kind: str, check: dict) -> dict:
    browser = secrets.token_urlsafe(24)
    pending = Pending(
        id=secrets.token_hex(16),
        user_id=user.id,
        kind=kind,
        check_id=check["check_id"],
        browser_hash=sha(browser),
        created_at=time.time(),
    )
    db.add(pending)
    db.commit()
    response.set_cookie(PENDING_COOKIE, browser, max_age=900, httponly=True, samesite="lax", path="/")
    back = f"{WEB}/cadence/return?{urlencode({'pending': pending.id})}"
    return {
        "status": "verify",
        "pending": pending.id,
        "verify_url": f"{check['verify_url']}?{urlencode({'return_to': back})}",
        "check": summary(check),
    }


def finish_pending(db: Session, pending_id: str, kind: str, browser: str | None) -> tuple[User, dict]:
    pending = db.get(Pending, pending_id)
    if pending is None or pending.kind != kind or pending.done_at is not None:
        raise HTTPException(400, "pending_unknown")
    if not browser or not hmac.compare_digest(pending.browser_hash, sha(browser)):
        raise HTTPException(403, "pending_other_browser")
    check = cadence("GET", f"/v1/checks/{pending.check_id}")
    if not check["resolved"]:
        raise HTTPException(403, "not_verified")
    pending.done_at = time.time()
    db.commit()
    return db.get(User, pending.user_id), check


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
    user = User(email=email, password_hash=hash_password(body.password))
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


@app.post("/api/cadence/disconnect", dependencies=[api])
def cadence_disconnect(session: Current, db: Db) -> dict:
    user, web = session
    user.cadence_subject = user.cadence_since = None
    db.commit()
    return me_view(user, web)


@app.get("/api/customers", dependencies=[api])
def customers(session: Current) -> dict:
    return {"fictional": True, "customers": CUSTOMERS}


class ExportBody(BaseModel):
    evidence: str | None = Field(default=None, max_length=64)


@app.post("/api/export", dependencies=[api])
def export(body: ExportBody, response: Response, session: Current, db: Db) -> dict:
    """Sensitive: needs Cadence to agree (or the person to verify) when Cadence is on."""
    user, _ = session
    if user.cadence_subject is None:
        return {"status": "released", "customers": CUSTOMERS, "check": None}
    check = cadence(
        "POST", "/v1/checks", {"subject": user.cadence_subject, "evidence": body.evidence, "action": "export_customers"}
    )
    if check["resolved"]:
        return {"status": "released", "customers": CUSTOMERS, "check": summary(check)}
    return start_pending(db, response, user, "export", check)


@app.post("/api/finish", dependencies=[api])
def finish(
    body: PendingBody,
    response: Response,
    db: Db,
    browser: Annotated[str | None, Cookie(alias=PENDING_COOKIE)] = None,
    token: Annotated[str | None, Cookie(alias=COOKIE)] = None,
) -> dict:
    """Back from Cadence: finish whatever was waiting (a sign-in or an export)."""
    pending = db.get(Pending, body.pending)
    if pending is None:
        raise HTTPException(400, "pending_unknown")
    if pending.kind == "sign_in":
        return login_finish(body, response, db, browser)
    user, _ = current(db, token)
    if user.id != pending.user_id:
        raise HTTPException(403, "pending_other_user")
    _, check = finish_pending(db, body.pending, "export", browser)
    return {"status": "released", "kind": "export", "customers": CUSTOMERS, "check": summary(check)}


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "site_key": SITE_KEY}
