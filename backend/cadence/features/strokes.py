"""Block K: geometry-free stroke features.

These need no knowledge of where targets were, so they work on free-form movement
(SapiMouse, passive capture inside an app) as well as on challenge rounds. A stroke is the
movement that ends in a button press. Every feature is temporal or dimensionless (divided
by the stroke's own length), so screen resolution and pointer speed settings matter less;
they still matter some, which is why device is reported as a confound.
"""

import math

import numpy as np

from ..challenges.replay import DOWN, UP
from .extract import _iqr, _median, _Trace

K_SCHEMA = 1
MAX_STROKE_MS = 3000  # only the last 3 s before a press count as the movement towards it
MIN_CHORD_PX = 10  # presses without a real movement before them are not strokes

STROKE_KEYS = (
    "log_ms", "t_peak_frac", "peak_norm", "mean_peak", "efficiency",
    "max_dev", "signed_dev", "submoves", "dwell", "hold",
)  # fmt: skip
K_FEATURE_NAMES: tuple[str, ...] = tuple(f"k_{key}_{stat}" for key in STROKE_KEYS for stat in ("med", "iqr"))


def strokes(events: list) -> list[dict[str, float]]:
    """One feature dict per point-and-press movement. `events` are [t_ms, x, y, kind, buttons]."""
    if len(events) < 4:
        return []
    trace = _Trace(events)
    raw_t, kind = trace.raw_t, trace.kind
    downs, ups = np.nonzero(kind == DOWN)[0], np.nonzero(kind == UP)[0]
    out = []
    for d in downs:
        t_down = raw_t[d]
        before = ups[ups < d]
        start = max(raw_t[before[-1]] if before.size else raw_t[0], t_down - MAX_STROKE_MS)
        w = trace.window(start, t_down)
        x, y, speed, t = trace.x[w], trace.y[w], trace.speed[w], trace.t[w]
        if len(t) < 4 or speed.max() <= 0:
            continue
        moving = np.nonzero(speed > 0.1 * speed.max())[0]
        x, y, speed, t = (a[moving[0] : moving[-1] + 1] for a in (x, y, speed, t))
        chord = math.hypot(x[-1] - x[0], y[-1] - y[0]) if len(t) >= 3 else 0.0
        duration = float(t[-1] - t[0]) if len(t) >= 3 else 0.0
        if chord < MIN_CHORD_PX or duration <= 0:
            continue
        peak = float(speed.max())
        path = float(np.hypot(np.diff(x), np.diff(y)).sum())
        ex, ey = x[-1] - x[0], y[-1] - y[0]
        deviation = ((x - x[0]) * ey - (y - y[0]) * ex) / chord
        inner = speed[1:-1]
        peaks = (inner > speed[:-2]) & (inner >= speed[2:]) & (inner > 0.2 * peak)
        after = ups[ups > d]
        out.append({
            "log_ms": math.log(duration),
            "t_peak_frac": float(t[int(speed.argmax())] - t[0]) / duration,
            "peak_norm": peak / chord,
            "mean_peak": float(speed.mean()) / peak,
            "efficiency": chord / path if path > 0 else math.nan,
            "max_dev": float(np.abs(deviation).max()) / chord,
            "signed_dev": float(deviation.mean()) / chord,
            "submoves": float(peaks.sum()),
            "dwell": float(t_down - t[-1]),
            "hold": float(raw_t[after[0]] - t_down) if after.size else math.nan,
        })  # fmt: skip
    return out


def window_vector(window: list[dict[str, float]]) -> np.ndarray:
    """Median and spread of each stroke feature over a window of strokes."""
    values = []
    for key in STROKE_KEYS:
        column = [s[key] for s in window]
        values += [_median(column), _iqr(column)]
    return np.array(values, dtype=float)
