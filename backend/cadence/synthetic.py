"""SYNTHETIC pointer data. For tests and pipeline checks only.

Nothing produced here is evidence about real people. Samples built from it are tagged
`source = "synthetic"` and must never feed reported evaluation metrics.
"""

import math
import random
from dataclasses import dataclass

from .challenges.replay import DOWN, MOVE, UP
from .challenges.spec import Layout, track_position


@dataclass
class SyntheticProfile:
    """A made-up 'person': a handful of motor parameters."""

    fitts_a_ms: float = 130
    fitts_b_ms: float = 150
    reaction_ms: float = 260
    hold_ms: float = 95
    curve_px: float = 6
    aim_spread: float = 0.3  # endpoint scatter as a fraction of target radius
    track_lag_ms: float = 140
    track_noise_px: float = 3
    rate_hz: float = 125

    @classmethod
    def random(cls, rng: random.Random) -> "SyntheticProfile":
        return cls(
            fitts_a_ms=rng.uniform(90, 190),
            fitts_b_ms=rng.uniform(110, 210),
            reaction_ms=rng.uniform(200, 380),
            hold_ms=rng.uniform(60, 150),
            curve_px=rng.uniform(-14, 14),
            aim_spread=rng.uniform(0.15, 0.5),
            track_lag_ms=rng.uniform(80, 240),
            track_noise_px=rng.uniform(1.5, 6),
        )


class _Pen:
    def __init__(self, profile: SyntheticProfile, rng: random.Random):
        self.p, self.rng = profile, rng
        self.dt = 1000 / profile.rate_hz
        self.t, self.x, self.y = 20.0, 400.0, 250.0
        self.events: list[list[float]] = []

    def emit(self, kind: int) -> None:
        self.events.append(
            [round(self.t, 1), round(self.x, 1), round(self.y, 1), kind, 1 if kind == DOWN else 0]
        )

    def wait(self, ms: float) -> None:
        self.t += ms

    def aim_point(self, cx: float, cy: float, r: float) -> tuple[float, float]:
        spread = r * self.p.aim_spread
        return cx + self.rng.gauss(0, spread / 2), cy + self.rng.gauss(0, spread / 2)

    def move_to(self, tx: float, ty: float, width: float, stop_inside=None) -> None:
        """Minimum-jerk reach with a sideways bow. Optionally stops at the first sample inside a circle."""
        sx, sy = self.x, self.y
        dist = math.hypot(tx - sx, ty - sy)
        if dist < 1:
            return
        difficulty = math.log2(dist / width + 1)
        duration = (self.p.fitts_a_ms + self.p.fitts_b_ms * difficulty) * self.rng.uniform(0.9, 1.1)
        nx, ny = -(ty - sy) / dist, (tx - sx) / dist
        steps = max(2, int(duration / self.dt))
        for k in range(1, steps + 1):
            u = k / steps
            s = 10 * u**3 - 15 * u**4 + 6 * u**5
            bow = self.p.curve_px * math.sin(math.pi * u)
            self.t += self.dt
            self.x, self.y = sx + (tx - sx) * s + nx * bow, sy + (ty - sy) * s + ny * bow
            self.emit(MOVE)
            if stop_inside and math.hypot(self.x - stop_inside[0], self.y - stop_inside[1]) <= stop_inside[2]:
                return

    def press(self) -> None:
        self.wait(self.rng.uniform(30, 70))
        self.emit(DOWN)

    def release(self) -> None:
        self.wait(self.p.hold_ms * self.rng.uniform(0.85, 1.15))
        self.emit(UP)


def simulate_round(layout: Layout, profile: SyntheticProfile, rng: random.Random) -> list[list[float]]:
    """Events for one clean pass through `layout`, in the wire format the SDK sends."""
    pen = _Pen(profile, rng)
    for task in layout["tasks"]:
        pen.wait(profile.reaction_ms * rng.uniform(0.85, 1.2))
        if task["kind"] == "click":
            pen.move_to(*pen.aim_point(task["x"], task["y"], task["r"]), width=2 * task["r"])
            pen.press()
            pen.release()
        elif task["kind"] == "drag":
            src, dst = task["from"], task["to"]
            pen.move_to(*pen.aim_point(src["x"], src["y"], src["r"]), width=2 * src["r"])
            pen.press()
            pen.wait(rng.uniform(60, 120))
            pen.move_to(*pen.aim_point(dst["x"], dst["y"], dst["r"]), width=2 * dst["r"])
            pen.release()
        elif task["kind"] == "track":
            sx, sy = track_position(task, 0)
            pen.move_to(sx, sy, width=2 * task["r"], stop_inside=(sx, sy, task["r"]))
            t0, ox, oy = pen.t, pen.x - sx, pen.y - sy
            while pen.t - t0 < task["duration_ms"]:
                pen.t += pen.dt
                elapsed = pen.t - t0
                tx, ty = track_position(task, max(0.0, elapsed - profile.track_lag_ms))
                settle = math.exp(-elapsed / 180)  # initial offset decays as pursuit locks on
                pen.x = tx + ox * settle + rng.gauss(0, profile.track_noise_px)
                pen.y = ty + oy * settle + rng.gauss(0, profile.track_noise_px)
                pen.emit(MOVE)
    return pen.events
