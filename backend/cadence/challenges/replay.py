"""Server-side replay of a submitted round.

The server never trusts client claims about which targets were hit. It walks the raw
event stream against the layout it generated and derives the task timeline itself.
The browser runs the same rules on the same (rounded) samples, so both agree.

Passing this replay shows the events fit *this* layout within plausible timing. It does
not prove a human produced them.
"""

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .spec import Layout, track_position

MOVE, DOWN, UP = 0, 1, 2

HIT_TOL_PX = 2.0
MIN_EVENTS = 100
MAX_EVENTS = 60_000
COORD_LIMIT = 4000.0
CLOCK_SLACK_MS = 1500.0
MIN_TRACK_COVERAGE = 0.10
TRACK_GRID_HZ = 60


@dataclass
class Replay:
    ok: bool
    reason: str | None = None
    timeline: list[dict[str, Any]] = field(default_factory=list)
    duration_ms: float = 0.0


def _fail(reason: str) -> Replay:
    return Replay(ok=False, reason=reason)


def _inside(x: float, y: float, target: dict[str, Any]) -> bool:
    return (x - target["x"]) ** 2 + (y - target["y"]) ** 2 <= (target["r"] + HIT_TOL_PX) ** 2


def track_coverage(t: np.ndarray, x: np.ndarray, y: np.ndarray, task: dict, t0: float) -> float:
    """Fraction of the tracking window with the pointer on the target (position held between events)."""
    n = int(task["duration_ms"] / 1000 * TRACK_GRID_HZ)
    grid = t0 + np.arange(n) * (1000 / TRACK_GRID_HZ)
    px, py = np.interp(grid, t, x), np.interp(grid, t, y)
    target = np.array([track_position(task, g - t0) for g in grid])
    dist = np.hypot(px - target[:, 0], py - target[:, 1])
    return float(np.mean(dist <= task["r"] + HIT_TOL_PX))


def replay_round(layout: Layout, events: list, server_elapsed_ms: float) -> Replay:
    n = len(events)
    if not MIN_EVENTS <= n <= MAX_EVENTS:
        return _fail("event_count_out_of_bounds")
    try:
        arr = np.asarray(events, dtype=float)
    except (TypeError, ValueError):
        return _fail("malformed_events")
    if arr.ndim != 2 or arr.shape[1] != 5 or not np.isfinite(arr).all():
        return _fail("malformed_events")

    t, x, y, kind = arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3]
    if t[0] < 0 or np.any(np.diff(t) < 0):
        return _fail("timestamps_not_monotonic")
    if np.abs(x).max() > COORD_LIMIT or np.abs(y).max() > COORD_LIMIT:
        return _fail("coordinates_out_of_bounds")
    if not np.isin(kind, (MOVE, DOWN, UP)).all():
        return _fail("unknown_event_type")
    # The client clock starts after the challenge was issued, so it cannot run ahead of ours.
    if t[-1] > server_elapsed_ms + CLOCK_SLACK_MS:
        return _fail("client_clock_ahead_of_server")

    timeline: list[dict[str, Any]] = []
    i = 0  # next unread event
    t_prev = float(t[0])

    for task in layout["tasks"]:
        if task["kind"] == "click":
            misses = 0
            hit = None
            while i < n:
                if kind[i] == DOWN:
                    if _inside(x[i], y[i], task):
                        hit = i
                        break
                    misses += 1
                i += 1
            if hit is None:
                return _fail(f"target_not_hit:{task['id']}")
            timeline.append(
                {"id": task["id"], "kind": "click", "t_start": t_prev, "t_end": float(t[hit]), "misses": misses}
            )
            t_prev = float(t[hit])
            i = hit + 1

        elif task["kind"] == "drag":
            attempts = 0
            done = None
            while i < n and done is None:
                if kind[i] == DOWN and _inside(x[i], y[i], task["from"]):
                    ups = np.nonzero(kind[i + 1 :] == UP)[0]
                    if ups.size == 0:
                        break
                    u = i + 1 + int(ups[0])
                    attempts += 1
                    if _inside(x[u], y[u], task["to"]):
                        done = (i, u)
                    i = u + 1
                else:
                    i += 1
            if done is None:
                return _fail(f"drag_not_completed:{task['id']}")
            timeline.append(
                {
                    "id": task["id"],
                    "kind": "drag",
                    "t_start": t_prev,
                    "t_down": float(t[done[0]]),
                    "t_end": float(t[done[1]]),
                    "attempts": attempts,
                }
            )
            t_prev = float(t[done[1]])

        elif task["kind"] == "track":
            sx, sy = track_position(task, 0)
            start_target = {"x": sx, "y": sy, "r": task["r"]}
            start = next((j for j in range(i, n) if _inside(x[j], y[j], start_target)), None)
            if start is None:
                return _fail(f"tracking_not_started:{task['id']}")
            t0 = float(t[start])
            t_end = t0 + task["duration_ms"]
            if t_end > server_elapsed_ms + CLOCK_SLACK_MS:
                return _fail("submitted_before_tracking_finished")
            coverage = track_coverage(t, x, y, task, t0)
            if coverage < MIN_TRACK_COVERAGE:
                return _fail(f"tracking_not_followed:{task['id']}")
            timeline.append(
                {
                    "id": task["id"],
                    "kind": "track",
                    "t_start": t0,
                    "t_end": t_end,
                    "t_shown": t_prev,
                    "coverage": round(coverage, 4),
                }
            )
            t_prev = t_end
            i = int(np.searchsorted(t, t_end, side="right"))

    return Replay(ok=True, timeline=timeline, duration_ms=t_prev - float(t[0]))
