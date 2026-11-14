"""Challenge spec v1.

FROZEN once volunteer collection starts: changing any constant here makes earlier
samples incomparable. Add a new version instead of editing this one.

A round is a fixed task sequence with a fresh layout:
  c0            a start target (the move onto it has no defined origin, so it is unscored)
  c1..c8        eight target clicks, one per direction octant, stratified by distance and size
  d1..d3        three drag-and-drops
  t1            six seconds following a moving target
Coordinates are CSS pixels in an 800x500 area, origin top-left, y down.
"""

import math
import random
from typing import Any

SPEC_VERSION = 1

AREA_W, AREA_H = 800, 500
MARGIN = 44

N_CLICKS = 8
START_R = 24
CLICK_RADII = (16, 28)
CLICK_DIST_BINS = ((110, 170), (210, 290), (330, 430))
OCTANT_JITTER_DEG = 15

N_DRAGS = 3
DRAG_TOKEN_R = 22
DRAG_ZONE_RADII = (34, 46)
DRAG_DIST_BINS = ((170, 250), (280, 380))

TRACK_MS = 6000
TRACK_RAMP_MS = 600
TRACK_R = 26
TRACK_CENTER = (AREA_W / 2, AREA_H / 2)
TRACK_AMP = (270, 150)
TRACK_FREQS_HZ = (0.11, 0.27, 0.47)
TRACK_WEIGHTS = (1.0, 0.5, 0.28)

Layout = dict[str, Any]


def _in_bounds(x: float, y: float, r: float) -> bool:
    return MARGIN + r <= x <= AREA_W - MARGIN - r and MARGIN + r <= y <= AREA_H - MARGIN - r


def _round1(v: float) -> float:
    return round(v, 1)


def _click_chain(rng: random.Random) -> list[dict[str, Any]] | None:
    """One attempt at a start point plus eight moves, one per octant, all inside the area."""
    x, y = rng.uniform(300, 500), rng.uniform(200, 300)
    tasks = [{"kind": "click", "id": "c0", "x": _round1(x), "y": _round1(y), "r": START_R}]
    radii = [CLICK_RADII[i % 2] for i in range(N_CLICKS)]
    rng.shuffle(radii)
    octants = list(range(8))
    rng.shuffle(octants)
    bin_use = [0] * len(CLICK_DIST_BINS)

    for i, octant in enumerate(octants):
        r = radii[i]
        theta = math.radians(octant * 45 + rng.uniform(-OCTANT_JITTER_DEG, OCTANT_JITTER_DEG))
        # Prefer the least-used distance bin so each round covers short, medium and long moves.
        bins = sorted(range(len(CLICK_DIST_BINS)), key=lambda b: (bin_use[b], rng.random()))
        placed = False
        for b in bins:
            for _ in range(4):
                d = rng.uniform(*CLICK_DIST_BINS[b])
                nx, ny = x + d * math.cos(theta), y + d * math.sin(theta)
                if _in_bounds(nx, ny, r):
                    x, y, placed = nx, ny, True
                    bin_use[b] += 1
                    break
            if placed:
                break
        if not placed:
            return None
        tasks.append({"kind": "click", "id": f"c{i + 1}", "x": _round1(x), "y": _round1(y), "r": r})
    return tasks


def _drags(rng: random.Random) -> list[dict[str, Any]]:
    tasks = []
    for i in range(N_DRAGS):
        zone_r = DRAG_ZONE_RADII[i % len(DRAG_ZONE_RADII)]
        lo, hi = DRAG_DIST_BINS[i % len(DRAG_DIST_BINS)]
        while True:
            fx = rng.uniform(MARGIN + DRAG_TOKEN_R, AREA_W - MARGIN - DRAG_TOKEN_R)
            fy = rng.uniform(MARGIN + DRAG_TOKEN_R, AREA_H - MARGIN - DRAG_TOKEN_R)
            theta = rng.uniform(0, 2 * math.pi)
            d = rng.uniform(lo, hi)
            tx, ty = fx + d * math.cos(theta), fy + d * math.sin(theta)
            if _in_bounds(tx, ty, zone_r):
                break
        tasks.append(
            {
                "kind": "drag",
                "id": f"d{i + 1}",
                "from": {"x": _round1(fx), "y": _round1(fy), "r": DRAG_TOKEN_R},
                "to": {"x": _round1(tx), "y": _round1(ty), "r": zone_r},
            }
        )
    return tasks


def _track(rng: random.Random) -> dict[str, Any]:
    n = len(TRACK_FREQS_HZ)
    return {
        "kind": "track",
        "id": "t1",
        "duration_ms": TRACK_MS,
        "ramp_ms": TRACK_RAMP_MS,
        "r": TRACK_R,
        "center": {"x": TRACK_CENTER[0], "y": TRACK_CENTER[1]},
        "amp": {"x": TRACK_AMP[0], "y": TRACK_AMP[1]},
        "freqs_hz": list(TRACK_FREQS_HZ),
        "weights": list(TRACK_WEIGHTS),
        "phase_x": [round(rng.uniform(0, 2 * math.pi), 4) for _ in range(n)],
        "phase_y": [round(rng.uniform(0, 2 * math.pi), 4) for _ in range(n)],
    }


def generate_layout(seed: int) -> Layout:
    rng = random.Random(seed)
    clicks = None
    while clicks is None:
        clicks = _click_chain(rng)
    return {
        "version": SPEC_VERSION,
        "area": {"w": AREA_W, "h": AREA_H},
        "tasks": [*clicks, *_drags(rng), _track(rng)],
    }


def track_position(task: dict[str, Any], t_ms: float) -> tuple[float, float]:
    """Target centre `t_ms` after tracking started. Mirrored in packages/sdk/src/track.ts.

    Time is eased in over `ramp_ms` so the target accelerates smoothly from rest.
    """
    ramp = task["ramp_ms"]
    t = max(0.0, min(t_ms, task["duration_ms"]))
    tau_s = (t * t / (2 * ramp) if t < ramp else t - ramp / 2) / 1000
    total = sum(task["weights"])

    def axis(phases: list[float], centre: float, amp: float) -> float:
        s = sum(
            w * math.sin(2 * math.pi * f * tau_s + p)
            for w, f, p in zip(task["weights"], task["freqs_hz"], phases)
        )
        return centre + amp * s / total

    return (
        axis(task["phase_x"], task["center"]["x"], task["amp"]["x"]),
        axis(task["phase_y"], task["center"]["y"], task["amp"]["y"]),
    )
