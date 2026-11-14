"""Movement features for one challenge round.

Used by both the API (scoring) and the training scripts, so the two can never drift apart.

Design rules, from the research in PLAN.md section 2:
- Everything is computed on a fixed 60 Hz resampled grid, so a device's polling rate and
  the browser's timer precision do not leak into the features.
- Spatial quantities are divided by the task's own geometry (reach distance, target
  radius), so a fresh layout does not change what a feature means.
- No account, device or session identifier is ever an input.
"""

import math
from typing import Any

import numpy as np

from ..challenges.replay import DOWN, UP
from ..challenges.spec import Layout, track_position

FEATURE_SCHEMA = 1
GRID_HZ = 60
DT_S = 1 / GRID_HZ

_REACH_KEYS = (
    "ms_per_bit", "reaction", "peak_norm", "t_peak_frac", "efficiency",
    "max_dev", "signed_dev", "submoves", "dwell",
)  # fmt: skip
_CLICK_KEYS = (*_REACH_KEYS, "hold", "end_dx", "end_dy", "end_r")

FEATURE_NAMES: tuple[str, ...] = (
    *(f"click_{key}_{stat}" for key in _CLICK_KEYS for stat in ("med", "iqr")),
    "click_fitts_a", "click_fitts_b", "click_misses",
    "drag_pickup_ms_per_bit", "drag_carry_ms_per_bit", "drag_carry_peak_norm",
    "drag_carry_efficiency", "drag_carry_t_peak_frac", "drag_drop_r", "drag_retries",
    "track_rms", "track_coverage", "track_lag", "track_gain", "track_jitter", "track_onset",
)  # fmt: skip


class _Trace:
    """Pointer path on the 60 Hz grid, with smoothed speed."""

    def __init__(self, events: list) -> None:
        arr = np.asarray(events, dtype=float)
        self.raw_t, self.raw_x, self.raw_y, self.kind = arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3]
        last_of_tick = np.append(np.diff(self.raw_t) > 0, True)
        t, x, y = self.raw_t[last_of_tick], self.raw_x[last_of_tick], self.raw_y[last_of_tick]
        self.t = np.arange(t[0], t[-1] + 1e-9, 1000 * DT_S)
        self.x, self.y = np.interp(self.t, t, x), np.interp(self.t, t, y)
        speed = np.hypot(np.gradient(self.x, DT_S), np.gradient(self.y, DT_S)) if len(self.t) > 1 else np.zeros(1)
        self.speed = np.convolve(speed, (0.25, 0.5, 0.25), mode="same")

    def window(self, t0: float, t1: float) -> slice:
        return slice(int(np.searchsorted(self.t, t0)), int(np.searchsorted(self.t, t1, side="right")))

    def event_at(self, t: float, kind: int) -> int | None:
        hits = np.nonzero((self.kind == kind) & np.isclose(self.raw_t, t))[0]
        return int(hits[0]) if hits.size else None

    def next_event(self, after: int, kind: int) -> int | None:
        hits = np.nonzero(self.kind[after + 1 :] == kind)[0]
        return after + 1 + int(hits[0]) if hits.size else None


def _reach(trace: _Trace, t0: float, t1: float, target: tuple[float, float], width: float) -> dict[str, float]:
    """One aimed movement from wherever the pointer was at `t0` to `target`, ending at `t1`."""
    w = trace.window(t0, t1)
    x, y, speed, t = trace.x[w], trace.y[w], trace.speed[w], trace.t[w]
    if len(t) < 4:
        return {}
    distance = math.hypot(target[0] - x[0], target[1] - y[0])
    peak = float(speed.max())
    if distance < 1 or peak <= 0:
        return {}
    duration = t1 - t0
    moving = np.nonzero(speed > 0.1 * peak)[0]
    path = float(np.hypot(np.diff(x), np.diff(y)).sum())
    # Signed perpendicular distance from the straight line between start and end points.
    ex, ey = x[-1] - x[0], y[-1] - y[0]
    chord = math.hypot(ex, ey) or 1.0
    deviation = ((x - x[0]) * ey - (y - y[0]) * ex) / chord
    inner = speed[1:-1]
    peaks = (inner > speed[:-2]) & (inner >= speed[2:]) & (inner > 0.2 * peak)
    return {
        "ms_per_bit": duration / math.log2(distance / width + 1),
        "reaction": float(t[moving[0]] - t0),
        "peak_norm": peak / distance,
        "t_peak_frac": float(t[int(speed.argmax())] - t0) / duration,
        "efficiency": chord / path if path > 0 else math.nan,
        "max_dev": float(np.abs(deviation).max()) / distance,
        "signed_dev": float(deviation.mean()) / distance,
        "submoves": float(peaks.sum()),
        "dwell": float(t1 - t[moving[-1]]),
        "_id": math.log2(distance / width + 1),
        "_ms": duration,
    }


def _median(values: list[float]) -> float:
    finite = [v for v in values if math.isfinite(v)]
    return float(np.median(finite)) if finite else math.nan


def _iqr(values: list[float]) -> float:
    finite = [v for v in values if math.isfinite(v)]
    return float(np.subtract(*np.percentile(finite, [75, 25]))) if len(finite) >= 4 else math.nan


def _clicks(trace: _Trace, tasks: dict, steps: list[dict]) -> dict[str, float]:
    reaches: list[dict[str, float]] = []
    for step in steps[1:]:  # the first click only starts the round
        task = tasks[step["id"]]
        reach = _reach(trace, step["t_start"], step["t_end"], (task["x"], task["y"]), 2 * task["r"])
        down = trace.event_at(step["t_end"], DOWN)
        if reach and down is not None:
            up = trace.next_event(down, UP)
            dx = (trace.raw_x[down] - task["x"]) / task["r"]
            dy = (trace.raw_y[down] - task["y"]) / task["r"]
            reach |= {
                "hold": trace.raw_t[up] - trace.raw_t[down] if up is not None else math.nan,
                "end_dx": dx,
                "end_dy": dy,
                "end_r": math.hypot(dx, dy),
            }
        reaches.append(reach)

    out: dict[str, float] = {}
    for key in _CLICK_KEYS:
        values = [r.get(key, math.nan) for r in reaches]
        out[f"click_{key}_med"], out[f"click_{key}_iqr"] = _median(values), _iqr(values)
    fitted = [(r["_id"], r["_ms"]) for r in reaches if r]
    if len(fitted) >= 4 and np.ptp([f[0] for f in fitted]) > 0.5:
        slope, intercept = np.polyfit(*zip(*fitted), 1)
        out["click_fitts_a"], out["click_fitts_b"] = float(intercept), float(slope)
    else:
        out["click_fitts_a"] = out["click_fitts_b"] = math.nan
    out["click_misses"] = float(sum(step.get("misses", 0) for step in steps[1:]))
    return out


def _drags(trace: _Trace, tasks: dict, steps: list[dict]) -> dict[str, float]:
    pickup, carry, drop = [], [], []
    for step in steps:
        src, dst = tasks[step["id"]]["from"], tasks[step["id"]]["to"]
        pickup.append(_reach(trace, step["t_start"], step["t_down"], (src["x"], src["y"]), 2 * src["r"]))
        carry.append(_reach(trace, step["t_down"], step["t_end"], (dst["x"], dst["y"]), 2 * dst["r"]))
        up = trace.event_at(step["t_end"], UP)
        if up is not None:
            drop.append(math.hypot(trace.raw_x[up] - dst["x"], trace.raw_y[up] - dst["y"]) / dst["r"])
    return {
        "drag_pickup_ms_per_bit": _median([r.get("ms_per_bit", math.nan) for r in pickup]),
        "drag_carry_ms_per_bit": _median([r.get("ms_per_bit", math.nan) for r in carry]),
        "drag_carry_peak_norm": _median([r.get("peak_norm", math.nan) for r in carry]),
        "drag_carry_efficiency": _median([r.get("efficiency", math.nan) for r in carry]),
        "drag_carry_t_peak_frac": _median([r.get("t_peak_frac", math.nan) for r in carry]),
        "drag_drop_r": _median(drop),
        "drag_retries": float(sum(step.get("attempts", 1) - 1 for step in steps)),
    }


def _track(trace: _Trace, task: dict, step: dict) -> dict[str, float]:
    w = trace.window(step["t_start"], step["t_end"])
    t, x, y = trace.t[w], trace.x[w], trace.y[w]
    if len(t) < GRID_HZ:
        return {}
    target = np.array([track_position(task, ti - step["t_start"]) for ti in t])
    error = np.hypot(x - target[:, 0], y - target[:, 1])
    cursor_v = np.stack([np.gradient(x, DT_S), np.gradient(y, DT_S)])
    target_v = np.stack([np.gradient(target[:, 0], DT_S), np.gradient(target[:, 1], DT_S)])
    target_speed_rms = float(np.sqrt((target_v**2).sum(axis=0).mean())) or 1.0

    # Pursuit lag: the delay at which the pointer's velocity best matches the target's.
    lags = range(0, 25)  # 0 to 400 ms
    match = [float((cursor_v[:, lag:] * target_v[:, : target_v.shape[1] - lag]).sum()) for lag in lags]
    cursor_speed = np.hypot(*cursor_v)
    smooth = np.convolve(cursor_speed, np.ones(7) / 7, mode="same")
    return {
        "track_rms": float(np.sqrt((error**2).mean())) / task["r"],
        "track_coverage": float((error <= task["r"]).mean()),
        "track_lag": int(np.argmax(match)) * 1000 * DT_S,
        "track_gain": float(np.sqrt((cursor_speed**2).mean())) / target_speed_rms,
        "track_jitter": float(np.sqrt(((cursor_speed - smooth) ** 2).mean())) / target_speed_rms,
        "track_onset": step["t_start"] - step["t_shown"],
    }


def extract_round(layout: Layout, events: list, timeline: list[dict[str, Any]]) -> dict[str, float]:
    """Feature dictionary for one validated round. Missing measurements are NaN."""
    trace = _Trace(events)
    tasks = {task["id"]: task for task in layout["tasks"]}
    steps = {kind: [s for s in timeline if s["kind"] == kind] for kind in ("click", "drag", "track")}
    values = _clicks(trace, tasks, steps["click"]) | _drags(trace, tasks, steps["drag"])
    for step in steps["track"]:
        values |= _track(trace, tasks[step["id"]], step)
    return {name: float(values.get(name, math.nan)) for name in FEATURE_NAMES}


def to_vector(features: dict[str, float]) -> np.ndarray:
    return np.array([features.get(name, math.nan) for name in FEATURE_NAMES], dtype=float)
