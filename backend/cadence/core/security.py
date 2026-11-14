import hashlib
import secrets
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Response
from sqlalchemy import select

from .config import settings
from .db import Db
from .models import UserSession, now


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def open_session(db: Db, response: Response, **fields) -> UserSession:
    """Create a server-side session and set its cookie. Caller commits."""
    token = secrets.token_urlsafe(32)
    session = UserSession(
        token_hash=hash_token(token), expires_at=now() + settings.session_ttl_s, **fields
    )
    db.add(session)
    response.set_cookie(
        settings.session_cookie,
        token,
        max_age=settings.session_ttl_s,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return session


def close_session(response: Response) -> None:
    response.delete_cookie(settings.session_cookie, path="/")


def optional_session(
    db: Db, token: Annotated[str | None, Cookie(alias=settings.session_cookie)] = None
) -> UserSession | None:
    if token:
        session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
        if session and session.expires_at > now():
            return session
    return None


OptionalSession = Annotated[UserSession | None, Depends(optional_session)]


def current_session(session: OptionalSession) -> UserSession:
    if session is None:
        raise HTTPException(401, "no_active_session")
    return session


CurrentSession = Annotated[UserSession, Depends(current_session)]


def require_client_header(x_cadence_client: Annotated[str | None, Header()] = None) -> None:
    """CSRF guard for state-changing routes.

    Browsers cannot attach a custom header to a cross-site request without a CORS
    preflight, and this API allows no cross-origin callers.
    """
    if x_cadence_client != "1":
        raise HTTPException(403, "missing_client_header")
