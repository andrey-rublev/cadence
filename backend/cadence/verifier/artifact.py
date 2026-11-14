"""Versioned model artifacts: what the API loads and what training writes."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib

from ..core.config import settings
from ..features.extract import FEATURE_NAMES, FEATURE_SCHEMA
from .baseline import Baseline

ACTIVE_POINTER = "ACTIVE"


@dataclass
class Model:
    version: str
    verifier: Baseline
    reject_at: float
    accept_at: float
    # "volunteer" or "synthetic". A synthetic model says nothing about real people.
    source: str
    summary: dict[str, Any]


def save(directory: Path, model: Model) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "version": model.version,
            "feature_schema": FEATURE_SCHEMA,
            "feature_names": list(FEATURE_NAMES),
            "verifier": model.verifier,
            "reject_at": model.reject_at,
            "accept_at": model.accept_at,
            "source": model.source,
        },
        directory / "model.joblib",
    )
    (directory / "eval.json").write_text(json.dumps(model.summary, indent=2))
    (directory.parent / ACTIVE_POINTER).write_text(model.version)


def load_active(root: Path | None = None) -> Model | None:
    """The active model, or None when there is none this build can safely use.

    None is a normal state: the policy treats it as insufficient evidence and never approves.
    """
    root = root or settings.artifacts_dir
    pointer = root / ACTIVE_POINTER
    if not pointer.exists():
        return None
    directory = root / pointer.read_text().strip()
    try:
        blob = joblib.load(directory / "model.joblib")
        summary = json.loads((directory / "eval.json").read_text())
    except (OSError, ValueError, KeyError):
        return None
    # A model trained on a different feature definition would score garbage silently.
    if blob.get("feature_schema") != FEATURE_SCHEMA or blob.get("feature_names") != list(FEATURE_NAMES):
        return None
    if blob["source"] == "synthetic" and not settings.allow_synthetic_model:
        return None
    return Model(
        version=blob["version"],
        verifier=blob["verifier"],
        reject_at=blob["reject_at"],
        accept_at=blob["accept_at"],
        source=blob["source"],
        summary=summary,
    )
