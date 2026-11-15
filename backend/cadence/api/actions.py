import json
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..core.db import Db
from ..core.models import Verification, now
from ..core.security import CurrentSession, require_client_header
from ..demo_data import CUSTOMERS
from ..passive import MODALITIES, decide_passive, passive_model
from ..policy import CONSISTENT, decide
from ..product import (
    EXPORT_CUSTOMERS,
    PROTECTED_ACTIONS,
    CurrentAccount,
    active_model,
    enrollment,
    issue_grant,
    redeem_grant,
)

router = APIRouter(prefix="/api", tags=["actions"], dependencies=[Depends(require_client_header)])


class ExportBody(BaseModel):
    grant: str = Field(max_length=64)


@router.get("/customers")
def customers(account: CurrentAccount) -> dict:
    """Viewing is covered by ordinary sign-in. Exporting is the protected action."""
    return {"fictional": True, "customers": CUSTOMERS}


@router.post("/actions/{action}/authorize")
def authorize(
    action: str,
    account: CurrentAccount,
    session: CurrentSession,
    db: Db,
    method: Literal["passive", "challenge"] = "passive",
) -> dict:
    """Open a verification for a protected action.

    passive (default): decide now from recent ordinary use; a consistent result releases the
    action at once. challenge: say what challenge evidence is needed (rounds follow).
    """
    if action not in PROTECTED_ACTIONS:
        raise HTTPException(404, "unknown_action")
    if method == "passive":
        decision = decide_passive(db, account.id, session).to_dict()
    else:
        vectors, sessions = enrollment(db, account.id)
        decision = decide(active_model(), vectors, sessions, probes=[]).to_dict()
    verification = Verification(
        id=secrets.token_hex(16),
        session_id=session.id,
        account_id=account.id,
        action=action,
        decision_json=json.dumps(decision),
    )
    db.add(verification)
    grant = None
    if method == "passive" and decision["outcome"] == CONSISTENT:
        verification.resolved_by = "behavior"
        grant = issue_grant(db, session, action, basis="behavior")
    db.commit()
    return {"verification_id": verification.id, "method": method, "decision": decision, "grant": grant.id if grant else None}


@router.post("/export")
def export(body: ExportBody, account: CurrentAccount, session: CurrentSession, db: Db) -> dict:
    """The protected action. Succeeds only with a live grant bound to this session and action."""
    grant = redeem_grant(db, session, body.grant, EXPORT_CUSTOMERS)
    return {"fictional": True, "basis": grant.basis, "customers": CUSTOMERS}


@router.get("/model")
def model_summary(account: CurrentAccount) -> dict | None:
    """What the active challenge model was trained and tested on, exactly as the training script wrote it."""
    model = active_model()
    return None if model is None else model.summary


@router.get("/passive/models")
def passive_models(account: CurrentAccount) -> dict:
    """Summaries of the passive keyboard and pointer models, as their training scripts wrote them."""
    return {modality: None if (m := passive_model(modality)) is None else m.summary for modality in MODALITIES}


@router.get("/verifications")
def verifications(account: CurrentAccount, db: Db) -> dict:
    """Recent verification attempts for this account, newest first. Real outcomes only."""
    rows = db.scalars(
        select(Verification)
        .where(Verification.account_id == account.id)
        .order_by(Verification.created_at.desc())
        .limit(20)
    ).all()
    return {
        "verifications": [
            {
                "id": row.id,
                "action": row.action,
                "at": row.created_at,
                "resolved_by": row.resolved_by,
                "decision": json.loads(row.decision_json),
                "age_s": now() - row.created_at,
            }
            for row in rows
        ]
    }
