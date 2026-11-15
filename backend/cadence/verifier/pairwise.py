"""M1 and M2: pairwise verifiers that learn which feature differences matter.

B0 weighs every feature equally. A pairwise model looks at the per-feature gap between a
probe round and an enrollment template, and learns from training participants which gaps
separate "the same person in another session" from "someone else". The Counter-Strike
study in PLAN.md section 2.1 found explicit pair-comparison features gave its largest gain.

Positive pairs are always cross-session: a template from one session against rounds from
another session of the same person. Same-session pairs would teach the model to recognise
a sitting (posture, window, mood) rather than a person.

The score is the classifier's log-odds margin. It is a similarity, not a probability of
identity, and is never shown as one.
"""

import warnings
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from .baseline import Baseline
from .data import Round, sessions_by_person

Kind = Literal["logistic", "boosting"]


class NotTrainable(ValueError):
    """The training participants cannot supply both kinds of pair."""


@dataclass
class Pairwise:
    scaler: Baseline
    estimator: Any
    kind: Kind
    # Features never measured in training carry nothing and break tree binning, so they are dropped.
    used: np.ndarray | None = None

    def _gaps(self, enrollment: np.ndarray, probes: np.ndarray) -> np.ndarray:
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN columns are expected, handled below
            template = np.nanmedian(self.scaler._z(enrollment), axis=0)
            gaps = np.abs(self.scaler._z(probes) - template)
        return gaps if self.used is None else gaps[:, self.used]

    def score(self, enrollment: np.ndarray, probe: np.ndarray) -> float:
        return float(self.score_many(enrollment, np.atleast_2d(probe))[0])

    def score_many(self, enrollment: np.ndarray, probes: np.ndarray) -> np.ndarray:
        with threadpool_limits(1):
            return self.estimator.decision_function(self._gaps(enrollment, probes))


def _estimator(kind: Kind, seed: int):
    if kind == "logistic":
        # Strong regularisation: with tens of positive pairs, a free fit would memorise people.
        return make_pipeline(
            SimpleImputer(strategy="median", keep_empty_features=True),
            StandardScaler(),
            LogisticRegression(C=0.1, class_weight="balanced", max_iter=5000),
        )
    return HistGradientBoostingClassifier(
        max_depth=3,
        learning_rate=0.1,
        max_iter=100,
        max_bins=64,
        min_samples_leaf=10,
        l2_regularization=1.0,
        class_weight="balanced",
        early_stopping=False,
        random_state=seed,
    )


def fit_pairwise(rounds: list[Round], kind: Kind, seed: int = 0, negatives_per_template: int | None = None) -> Pairwise:
    """Fit on training participants' rounds only. With many people, `negatives_per_template`
    caps the impostor rounds drawn per enrollment template (a seeded random sample)."""
    scaler = Baseline.fit(np.array([r.vector for r in rounds]))
    people = sessions_by_person(rounds)
    model = Pairwise(scaler, None, kind)
    rng = np.random.default_rng(seed)
    features, labels = [], []
    for person, sessions in people.items():
        others_all = [r.vector for other, s_list in people.items() if other != person for s in s_list for r in s]
        for index, session in enumerate(sessions):
            enrollment = np.array([r.vector for r in session])
            same = [r.vector for other_index, s in enumerate(sessions) if other_index != index for r in s]
            others = others_all
            if negatives_per_template is not None and len(others) > negatives_per_template:
                others = [others[i] for i in rng.choice(len(others), negatives_per_template, replace=False)]
            for vectors, label in ((same, 1), (others, 0)):
                if vectors:
                    features.append(model._gaps(enrollment, np.array(vectors)))
                    labels += [label] * len(vectors)
    y = np.array(labels)
    if not (y == 1).any() or not (y == 0).any():
        raise NotTrainable("need at least one training participant with two sessions, and two participants")
    x = np.vstack(features)
    model.used = ~np.all(np.isnan(x), axis=0)
    # One thread: at this size, starting worker threads costs more than the work itself.
    with threadpool_limits(1):
        model.estimator = _estimator(kind, seed).fit(x[:, model.used], y)
    return model
