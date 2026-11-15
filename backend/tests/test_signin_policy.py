"""Use repeated-password evidence only for sign-ins with sufficient history."""
from types import SimpleNamespace

import numpy as np
import pytest

from cadence import passive
from cadence.features.rhythm import RhythmVerifier
from cadence.policy import CONSISTENT, INCONSISTENT, INSUFFICIENT, UNCERTAIN


@pytest.mark.parametrize('general', [CONSISTENT, INCONSISTENT, UNCERTAIN, INSUFFICIENT])
@pytest.mark.parametrize('offset,expected', [(0, CONSISTENT), (15, UNCERTAIN), (30, INCONSISTENT)])
def test_password_verdict_governs_signin_typing(monkeypatch, general, offset, expected):
    verifier = RhythmVerifier(10, 0, {3: {6: (-2, -1)}})
    monkeypatch.setattr(passive, 'rhythm_model', lambda: SimpleNamespace(verifier=verifier, version='test'))
    monkeypatch.setattr(passive, 'earlier_rhythms', lambda *args: [np.ones(11) * 100] * 3)
    monkeypatch.setattr(passive, 'passive_model', lambda modality: None)
    monkeypatch.setattr(passive, '_score_part', lambda db, account, modality, *args: passive.Part(
        modality, general if modality == 'keys' else INSUFFICIENT,
    ))
    window = {'modality': 'rhythm', 'use': 'password', 'presses': 6, 'values': [100 + offset] * 11}
    decision = passive.decide_evidence(None, 1, [window], 'northwind', 'sign_in')
    assert decision.outcome == expected
    keys = next(p for p in decision.parts if p.modality == 'keys')
    assert keys.password == 'compared'
    assert keys.earlier_sign_ins == 3


@pytest.mark.parametrize('action', ['export_customers', 'delete_account', None])
def test_other_actions_use_general_typing(monkeypatch, action):
    monkeypatch.setattr(passive, 'passive_model', lambda modality: None)
    monkeypatch.setattr(passive, '_score_part', lambda db, account, modality, *args: passive.Part(
        modality, INCONSISTENT if modality == 'keys' else INSUFFICIENT,
    ))
    def unexpected():
        pytest.fail('Password history must not be used for this action')
    monkeypatch.setattr(passive, 'rhythm_model', unexpected)
    window = {'modality': 'rhythm', 'use': 'password', 'presses': 6, 'values': [100] * 11}
    assert passive.decide_evidence(None, 1, [window], 'northwind', action).outcome == INCONSISTENT


@pytest.mark.parametrize('case,reason', [('absent', 'not_typed'), ('short', 'too_short'), ('missing_model', 'model_missing'), ('history', 'learning')])
def test_unavailable_comparison_keeps_general_verdict(monkeypatch, case, reason):
    verifier = RhythmVerifier(10, 0, {3: {6: (-2, -1)}})
    model = None if case == 'missing_model' else SimpleNamespace(verifier=verifier, version='test')
    monkeypatch.setattr(passive, 'rhythm_model', lambda: model)
    monkeypatch.setattr(passive, 'earlier_rhythms', lambda *args: [np.ones(11) * 100] * 2)
    window = {'modality': 'rhythm', 'presses': 6, 'values': None if case == 'short' else [100] * 11}
    result = passive._with_password_rhythm(None, 1, 'northwind', passive.Part('keys', UNCERTAIN), [] if case == 'absent' else [window])
    assert result.outcome == UNCERTAIN
    assert result.password == reason
