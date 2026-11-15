"""Passive verification: no challenge, no game.

The browser sends ordinary pointer movement and key timing. It arrives two ways:

- on the Cadence site, in windows of 12 clicks or 50 keys (`/api/passive`). During setup or a
  trusted session they build the profile; otherwise they are evidence for that sign-in;
- from a partner site, as whatever the person happened to do before signing in or before a
  sensitive action (`/v1/evidence`), with no minimum. A sign-in usually gives 15-45 keys,
  which the login model scores; longer stretches go to the 50-key model. Once a person has
  a few verified sign-ins on that site, the password part of a new sign-in is also compared
  key by key with how they typed it before (password rhythm, features/rhythm.py).

A decision combines the inputs that could be scored:

- each modality with a model and a sufficient profile is scored separately (mean of its
  latest windows against its own thresholds);
- any modality that looks INCONSISTENT holds the action;
- otherwise any CONSISTENT modality releases it;
- otherwise it is UNCERTAIN, and with no usable evidence it is INSUFFICIENT_EVIDENCE.

The client controls what it sends, so passive evidence can be scripted by an attacker who
controls the browser. It is a risk signal; the trusted fallback is always available.
"""

import hashlib
import json
from dataclasses import asdict, dataclass, field

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .core.config import settings
from .core.models import PassiveWindow, UserSession, now
from .features.keys import KEY_FEATURE_NAMES, KEY_SCHEMA, MODIFIER, presses_from_events
from .features.keys import window_vector as key_vector
from .features.keys import windows as key_windows
from .features.rhythm import MAX_PRESSES, MIN_PRESSES, RHYTHM_SCHEMA, presses_of, rhythm_vector, secret_run
from .features.rhythm import clean as clean_rhythm
from .features.strokes import K_FEATURE_NAMES, K_SCHEMA, strokes
from .features.strokes import window_vector as stroke_vector
from .policy import CONSISTENT, INCONSISTENT, INSUFFICIENT, UNCERTAIN
from .product import is_trusted
from .verifier.artifact import Model, load_active

MODALITIES = {
    "pointer": {"names": K_FEATURE_NAMES, "schema": K_SCHEMA},
    "keys": {"names": KEY_FEATURE_NAMES, "schema": KEY_SCHEMA},
}
KEY_WINDOW = 50
STROKE_WINDOW = 12
MIN_STROKES = 8


def passive_model(modality: str) -> Model | None:
    spec = MODALITIES[modality]
    return load_active(settings.artifacts_dir / modality, spec["names"], spec["schema"])


def login_model() -> Model | None:
    """The keyboard model for sign-in length typing (15-45 keys, password part hidden)."""
    return load_active(settings.artifacts_dir / "keys-login", KEY_FEATURE_NAMES, KEY_SCHEMA)


def history_model() -> Model | None:
    """Compares a sign-in with the person's earlier verified sign-ins on the same site. Its
    thresholds apply to the combined score (mean of this and the login model's score)."""
    return load_active(settings.artifacts_dir / "keys-history", KEY_FEATURE_NAMES, KEY_SCHEMA)


def rhythm_model() -> Model | None:
    """Compares the password part of a sign-in, key by key, with earlier sign-ins on the site."""
    return load_active(settings.artifacts_dir / "rhythm", ("rhythm",), RHYTHM_SCHEMA)


def earlier_sign_ins(db: Session, account_id: int, site_id: str) -> list[np.ndarray]:
    """The latest verified sign-ins on this site, oldest first (at most `history_max_sign_ins`)."""
    rows = db.scalars(
        select(PassiveWindow.values_json)
        .where(
            PassiveWindow.account_id == account_id,
            PassiveWindow.site_id == site_id,
            PassiveWindow.purpose == "signin",
            PassiveWindow.modality == "keys",
            PassiveWindow.feature_schema == KEY_SCHEMA,
        )
        .order_by(PassiveWindow.captured_at.desc(), PassiveWindow.id.desc())
        .limit(settings.history_max_sign_ins)
    ).all()
    return [np.array(json.loads(v), dtype=float) for v in reversed(rows)]


def windows_needed(modality: str) -> int:
    return settings.passive_min_windows if modality == "keys" else settings.setup_pointer_windows


def _vectors(db: Session, account_id: int, modality: str, purpose: str, **where) -> list[tuple[np.ndarray, int, float]]:
    query = select(PassiveWindow.values_json, PassiveWindow.session_id, PassiveWindow.captured_at).where(
        PassiveWindow.account_id == account_id,
        PassiveWindow.modality == modality,
        PassiveWindow.purpose == purpose,
        PassiveWindow.feature_schema == MODALITIES[modality]["schema"],
    )
    if "session_id" in where:
        query = query.where(PassiveWindow.session_id == where["session_id"])
    if "since" in where:
        query = query.where(PassiveWindow.captured_at >= where["since"])
    rows = db.execute(query.order_by(PassiveWindow.captured_at)).all()
    return [(np.array(json.loads(v), dtype=float), s, t) for v, s, t in rows]


def sign_ins(db: Session, account_id: int) -> int:
    """Separate sign-ins that contributed to the profile (full windows or sign-in typing)."""
    return int(
        db.scalar(
            select(func.count(func.distinct(PassiveWindow.session_id))).where(
                PassiveWindow.account_id == account_id, PassiveWindow.purpose.in_(("enroll", "login", "signin"))
            )
        )
        or 0
    )


def _sufficient(windows: int, signed_in: int, modality: str) -> bool:
    return windows >= windows_needed(modality) and signed_in >= settings.passive_min_sessions


def passive_profile(db: Session, account_id: int, session: UserSession | None = None) -> dict:
    """Per modality: profile windows and sign-ins so far, and evidence in this session."""
    signed_in = sign_ins(db, account_id)
    out = {}
    for modality in MODALITIES:
        enrolled = len(_vectors(db, account_id, modality, "enroll"))
        evidence = 0
        if session is not None:
            evidence = db.scalar(
                select(func.count()).where(
                    PassiveWindow.session_id == session.id,
                    PassiveWindow.modality == modality,
                    PassiveWindow.purpose == "evidence",
                    PassiveWindow.captured_at >= now() - settings.passive_evidence_ttl_s,
                )
            )
        out[modality] = {
            "windows": enrolled,
            "sessions": signed_in,
            "windows_needed": windows_needed(modality),
            "sessions_needed": settings.passive_min_sessions,
            "sufficient": _sufficient(enrolled, signed_in, modality),
            "recent_evidence": int(evidence or 0),
            "model": None if (m := passive_model(modality)) is None else {"version": m.version, "source": m.source},
        }
    return out


# ---------------------------------------------------------------- evidence from raw events


def evidence_windows(key_events: list, pointer_events: list) -> list[dict]:
    """Feature windows from a stretch of activity of any length. Short typing becomes one
    login-length window; anything under the minimums is simply not used."""
    out: list[dict] = []
    presses = presses_from_events(key_events) if key_events else []
    typed = sum(z != MODIFIER for _, _, z in presses)
    if typed >= settings.long_window_keys:
        full = key_windows(presses, KEY_WINDOW)
        used = sum(len(w) for w in full)
        rest = presses[used:]
        if sum(z != MODIFIER for _, _, z in rest) >= settings.long_window_keys:
            full.append(rest)
        for w in full:
            keys = sum(z != MODIFIER for _, _, z in w)
            out.append({"modality": "keys", "use": "standard", "keys": keys, "values": _clean(key_vector(w))})
    elif typed >= settings.min_login_keys:
        out.append({"modality": "keys", "use": "login", "keys": typed, "values": _clean(key_vector(presses))})

    found = strokes(pointer_events) if pointer_events else []
    groups = [found[i : i + STROKE_WINDOW] for i in range(0, len(found), STROKE_WINDOW)]
    for group in groups:
        if len(group) >= MIN_STROKES:
            out.append({"modality": "pointer", "use": "standard", "strokes": len(group), "values": _clean(stroke_vector(group))})
    return out


def rhythm_window(key_events: list) -> dict | None:
    """The password typed in a sign-in, as a rhythm window, or None if nothing was typed in a
    secret field (the password was filled in or pasted). Under MIN_PRESSES it carries no values."""
    run = secret_run(presses_from_events(key_events)) if key_events else []
    if not run:
        return None
    usable = MIN_PRESSES <= len(run) <= MAX_PRESSES
    return {
        "modality": "rhythm",
        "use": "password",
        "presses": len(run),
        "values": clean_rhythm(rhythm_vector(run)) if usable else None,
    }


def _clean(vector: np.ndarray) -> list[float | None]:
    return [None if not np.isfinite(v) else float(v) for v in vector.tolist()]


def _array(values: list[float | None]) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in values], dtype=float)


def window_digest(window: dict, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{json.dumps(window, sort_keys=True)}".encode()).hexdigest()


# ---------------------------------------------------------------- decisions


@dataclass
class Part:
    modality: str
    outcome: str
    reason: str | None = None
    score: float | None = None
    reject_at: float | None = None
    accept_at: float | None = None
    windows: int = 0
    enrollment_windows: int = 0
    model_version: str | None = None
    use: str = "standard"  # standard (50-key / 12-click windows) | login (sign-in length typing)
    amount: int = 0  # keys or clicks the scored evidence contained
    # Sign-ins only: earlier verified sign-ins on the same site the score also compared with.
    earlier_sign_ins: int = 0
    history_model_version: str | None = None
    # Sign-ins only: the password typed, compared key by key with earlier sign-ins on the site.
    # not_typed (filled in or pasted) | too_short | learning (too few earlier sign-ins of
    # this length) | compared | model_missing
    password: str | None = None
    rhythm_outcome: str | None = None
    rhythm_score: float | None = None
    rhythm_reject_at: float | None = None
    rhythm_accept_at: float | None = None
    rhythm_model_version: str | None = None


@dataclass
class PassiveDecision:
    outcome: str
    reason: str | None = None
    parts: list[Part] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _score_part(
    db: Session,
    account_id: int,
    modality: str,
    probes: list[np.ndarray],
    model: Model | None,
    use: str,
    amount: int,
    one_sitting_ok: bool = False,
) -> Part:
    part = Part(modality, INSUFFICIENT, use=use, amount=amount)
    if model is None:
        part.reason = "model_missing"
        return part
    part.model_version, part.reject_at, part.accept_at = model.version, model.reject_at, model.accept_at
    enrolled = _vectors(db, account_id, modality, "enroll")
    part.enrollment_windows = len(enrolled)
    signed_in = max(sign_ins(db, account_id), settings.passive_min_sessions if one_sitting_ok else 0)
    if not _sufficient(len(enrolled), signed_in, modality):
        part.reason = "not_enrolled"
        return part
    part.windows = len(probes)
    if not probes:
        part.reason = "no_interaction_yet"
        return part
    enrollment = np.array([v for v, _, _ in enrolled])
    scores = model.verifier.score_many(enrollment, np.array(probes))
    scores = scores[np.isfinite(scores)]
    if not scores.size:
        part.reason = "window_not_measurable"
        return part
    part.score = float(scores.mean())
    part.outcome = CONSISTENT if part.score > model.accept_at else INCONSISTENT if part.score < model.reject_at else UNCERTAIN
    return part


def _combine(parts: list[Part]) -> PassiveDecision:
    outcomes = {p.outcome for p in parts}
    if INCONSISTENT in outcomes:
        return PassiveDecision(INCONSISTENT, parts=parts)
    if CONSISTENT in outcomes:
        return PassiveDecision(CONSISTENT, parts=parts)
    if UNCERTAIN in outcomes:
        return PassiveDecision(UNCERTAIN, parts=parts)
    reasons = {p.reason for p in parts}
    # The most useful thing to tell the user: what would let a check happen.
    for reason in ("no_interaction_yet", "not_enrolled", "model_missing", "window_not_measurable"):
        if reason in reasons:
            return PassiveDecision(INSUFFICIENT, reason=reason, parts=parts)
    return PassiveDecision(INSUFFICIENT, reason="no_evidence", parts=parts)


def recommend_test(db: Session, account_id: int) -> dict:
    """Which short test is most likely to settle an unsure check for this particular person.

    For each input with a model and a profile, every profile sample is scored against the
    rest of the profile (leave one out). Where this person's own samples sit far above the
    accept threshold, a fresh sample of that input is likely to clear them; where they sit near
    or below it, that input is a poor way for this person to prove who they are. The margin is
    in units of the gap between the two thresholds, so typing and clicking compare fairly.
    """
    options = []
    signed_in = sign_ins(db, account_id)
    for modality in MODALITIES:
        model = passive_model(modality)
        enrolled = [v for v, _, _ in _vectors(db, account_id, modality, "enroll")]
        if model is None or len(enrolled) < 3 or not _sufficient(len(enrolled), signed_in, modality):
            continue
        matrix = np.array(enrolled)
        own = []
        for i in range(len(matrix)):
            rest = np.delete(matrix, i, axis=0)
            score = model.verifier.score_many(rest, matrix[i : i + 1])[0]
            if np.isfinite(score):
                own.append(float(score))
        if len(own) < 3:
            continue
        spread = max(model.accept_at - model.reject_at, 1e-6)
        median = float(np.median(own))
        cleared = float(np.mean([s > model.accept_at for s in own]))
        options.append(
            {
                "modality": modality,
                "margin": (median - model.accept_at) / spread,
                "own_samples_clear": cleared,  # share of this person's samples that would pass on their own
                "samples": len(own),
            }
        )
    options.sort(key=lambda o: (o["margin"], o["modality"] == "keys"), reverse=True)
    return {"recommended": options[0]["modality"] if options else None, "options": options}


def decide_passive(db: Session, account_id: int, session: UserSession) -> PassiveDecision:
    """A check on the Cadence site itself, from this sign-in's stored evidence windows."""
    parts = []
    for modality in MODALITIES:
        evidence = _vectors(
            db, account_id, modality, "evidence", session_id=session.id, since=now() - settings.passive_evidence_ttl_s
        )[-settings.passive_evidence_windows :]
        parts.append(_score_part(db, account_id, modality, [v for v, _, _ in evidence], passive_model(modality), "standard", 0))
    if is_trusted(session):
        # A learning sign-in: its windows go into the profile, so there is no evidence to
        # compare, and comparing a sitting with itself would flatter the score anyway.
        return PassiveDecision(INSUFFICIENT, reason="learning_session", parts=parts)
    return _combine(parts)


def score_practice(db: Session, account_id: int, window: dict) -> Part:
    """A practice sign-in, typed right after connecting a site, against the typing-test profile.
    The profile may still be a single sitting: practice is what adds the second one.

    A long email and password, or a few corrections, take a sign-in past `long_window_keys`;
    it is still one sign-in, scored by the model for that length."""
    model = login_model() if window["use"] == "login" else passive_model("keys")
    return _score_part(
        db, account_id, "keys", [_array(window["values"])], model, window["use"], window["keys"], one_sitting_ok=True
    )


def _with_earlier_sign_ins(db: Session, account_id: int, site_id: str, part: Part, probes: list[np.ndarray]) -> Part:
    """Fold the comparison with earlier verified sign-ins on this site into a sign-in's score.

    The combined score is the mean of the login model's score against the profile and the
    history model's score against those sign-ins; it has its own thresholds. With fewer than
    `history_min_sign_ins` earlier sign-ins, or no history model, the part is left as it was.
    """
    model = history_model()
    if model is None or part.score is None or not probes:
        return part
    earlier = earlier_sign_ins(db, account_id, site_id)
    if len(earlier) < settings.history_min_sign_ins:
        return part
    scores = model.verifier.score_many(np.array(earlier), np.array(probes))
    scores = scores[np.isfinite(scores)]
    if not scores.size:
        return part
    part.score = (part.score + float(scores.mean())) / 2
    part.reject_at, part.accept_at = model.reject_at, model.accept_at
    part.earlier_sign_ins, part.history_model_version = len(earlier), model.version
    part.outcome = CONSISTENT if part.score > model.accept_at else INCONSISTENT if part.score < model.reject_at else UNCERTAIN
    return part


def earlier_rhythms(db: Session, account_id: int, site_id: str, presses: int) -> list[np.ndarray]:
    """The latest verified sign-ins on this site whose password had this many presses, oldest
    first (at most `history_max_sign_ins`). A different count is a typo or a new password."""
    rows = db.scalars(
        select(PassiveWindow.values_json)
        .where(
            PassiveWindow.account_id == account_id,
            PassiveWindow.site_id == site_id,
            PassiveWindow.purpose == "signin",
            PassiveWindow.modality == "rhythm",
            PassiveWindow.feature_schema == RHYTHM_SCHEMA,
        )
        .order_by(PassiveWindow.captured_at.desc(), PassiveWindow.id.desc())
    ).all()
    vectors = [np.array(json.loads(v), dtype=float) for v in rows]
    matching = [v for v in vectors if presses_of(v) == presses][: settings.history_max_sign_ins]
    return list(reversed(matching))


def _with_password_rhythm(db: Session, account_id: int, site_id: str, part: Part, windows: list[dict]) -> Part:
    """Use the site's password comparison when measurable; otherwise retain the general verdict.

    The password model is calibrated for repeated text. Once it has enough matching history,
    its verdict governs typing, including uncertainty and mismatches. The general model's
    score remains available for diagnostics.
    """
    window = next((w for w in windows if w["modality"] == "rhythm"), None)
    if window is None:
        part.password = "not_typed"
        return part
    if window["values"] is None:
        part.password = "too_short"
        return part
    model = rhythm_model()
    if model is None:
        part.password = "model_missing"
        return part
    probe = np.array(window["values"], dtype=float)
    earlier = earlier_rhythms(db, account_id, site_id, window["presses"])
    thresholds = model.verifier.thresholds_for(len(earlier), window["presses"])
    part.rhythm_model_version = model.version
    if thresholds is None:
        part.password = "learning"
        return part
    score = model.verifier.score(np.array(earlier), probe)
    if not np.isfinite(score):
        part.password = "learning"
        return part
    part.password = "compared"
    part.rhythm_reject_at, part.rhythm_accept_at = thresholds
    part.rhythm_score = float(score)
    part.rhythm_outcome = CONSISTENT if score > thresholds[1] else INCONSISTENT if score < thresholds[0] else UNCERTAIN
    part.earlier_sign_ins = len(earlier)
    part.outcome = part.rhythm_outcome
    if part.outcome != INSUFFICIENT:
        part.reason = None
    return part


def decide_evidence(
    db: Session, account_id: int, windows: list[dict], site_id: str | None = None, action: str | None = None
) -> PassiveDecision:
    """A check for a partner site, from evidence of any length sent by the person's browser.
    A sign-in (`action` "sign_in") is also compared with earlier sign-ins on `site_id`."""
    latest = settings.passive_evidence_windows
    long_keys = [w for w in windows if w["modality"] == "keys" and w["use"] == "standard"][-latest:]
    short_keys = [w for w in windows if w["modality"] == "keys" and w["use"] == "login"]
    pointer = [w for w in windows if w["modality"] == "pointer"][-latest:]
    if long_keys or not short_keys:
        keys = _score_part(
            db, account_id, "keys", [_array(w["values"]) for w in long_keys], passive_model("keys"), "standard",
            sum(w["keys"] for w in long_keys),
        )  # fmt: skip
    else:
        probes = [_array(w["values"]) for w in short_keys]
        keys = _score_part(db, account_id, "keys", probes, login_model(), "login", sum(w["keys"] for w in short_keys))
        if action == "sign_in" and site_id is not None:
            keys = _with_earlier_sign_ins(db, account_id, site_id, keys, probes)
    if action == "sign_in" and site_id is not None:
        keys = _with_password_rhythm(db, account_id, site_id, keys, windows)
    clicks = _score_part(
        db, account_id, "pointer", [_array(w["values"]) for w in pointer], passive_model("pointer"), "standard",
        sum(w["strokes"] for w in pointer),
    )  # fmt: skip
    return _combine([clicks, keys])
