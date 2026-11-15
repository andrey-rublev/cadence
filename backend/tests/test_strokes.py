"""Block K stroke features: one stroke per real movement into a press, dimensionless values."""

import math

import numpy as np

from cadence.features.strokes import K_FEATURE_NAMES, strokes, window_vector


def reach(t0: float, start: tuple[float, float], end: tuple[float, float], ms: float = 400, hold: float = 90) -> list:
    """A smooth straight movement, a short pause, then a press and release."""
    events = []
    for i in range(int(ms / 8) + 1):
        f = i * 8 / ms
        s = f * f * (3 - 2 * f)  # smoothstep: bell-shaped speed
        events.append([t0 + i * 8, start[0] + s * (end[0] - start[0]), start[1] + s * (end[1] - start[1]), 0, 0])
    t_down = t0 + ms + 120
    return events + [[t_down, *end, 1, 1], [t_down + hold, *end, 2, 0]]


def test_one_stroke_per_reach_and_presses_in_place_are_ignored():
    events = reach(0, (0, 0), (300, 0)) + reach(1000, (300, 0), (300, 200))
    events += [[2000, 300, 200, 1, 1], [2080, 300, 200, 2, 0]]  # a click without moving first
    found = strokes(events)
    assert len(found) == 2
    first = found[0]
    assert first["efficiency"] > 0.98 and abs(first["signed_dev"]) < 0.01
    assert 0.3 < first["t_peak_frac"] < 0.7
    assert first["hold"] == 90 and first["dwell"] > 50
    assert math.isclose(math.exp(first["log_ms"]), 400, rel_tol=0.25)


def test_scaling_the_screen_does_not_change_shape_features():
    small = strokes(reach(0, (0, 0), (200, 100)))[0]
    large = strokes(reach(0, (0, 0), (400, 200)))[0]
    for key in ("efficiency", "t_peak_frac", "mean_peak", "max_dev", "peak_norm"):
        assert math.isclose(small[key], large[key], rel_tol=0.05, abs_tol=1e-3), key


def test_window_vector_has_every_feature():
    events = []
    for i in range(6):
        events += reach(i * 1000, (0, 0), (100 + 40 * i, 50))
    vector = window_vector(strokes(events))
    assert vector.shape == (len(K_FEATURE_NAMES),)
    assert np.isfinite(vector).all()
