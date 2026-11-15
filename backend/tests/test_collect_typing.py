"""Typing collection: volunteers record keyboard timing (never characters) across sessions."""

import numpy as np
import pytest

from cadence.core.config import settings

from .conftest import HEADERS, start_collect
from .test_passive_api import OWNER, body, typing


@pytest.fixture(autouse=True)
def fast_clock(monkeypatch):
    # Windows here are sent faster than they could be typed; the clock rule is tested elsewhere.
    monkeypatch.setattr(settings, "passive_clock_slack_ms", 10**9)


def test_a_typing_session_completes_after_its_samples(client):
    status = start_collect(client).json()
    assert status["mode"] == "typing" and status["typing_done"] == 0 and not status["complete"]
    rng = np.random.default_rng(0)
    for i in range(settings.collect_typing_windows):
        r = client.post("/api/collect/passive", json=body(typing(OWNER, rng)), headers=HEADERS)
        assert r.status_code == 200, r.text
    final = r.json()["collect"]
    assert final["complete"] and final["typing_done"] == settings.collect_typing_windows
    more = client.post("/api/collect/passive", json=body(typing(OWNER, rng)), headers=HEADERS)
    assert more.status_code == 409 and more.json()["detail"] == "session_complete"


def test_the_same_window_is_not_counted_twice(client):
    start_collect(client)
    window = body(typing(OWNER, np.random.default_rng(1)))
    assert client.post("/api/collect/passive", json=window, headers=HEADERS).status_code == 200
    assert client.post("/api/collect/passive", json=window, headers=HEADERS).status_code == 409


def test_typing_collection_needs_a_collection_session(client):
    r = client.post("/api/collect/passive", json=body(typing(OWNER, np.random.default_rng(2))), headers=HEADERS)
    assert r.status_code == 401
