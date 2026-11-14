import math
import random

from cadence.challenges.replay import replay_round
from cadence.challenges.spec import AREA_H, AREA_W, MARGIN, generate_layout, track_position
from cadence.synthetic import SyntheticProfile, simulate_round


def test_layout_is_deterministic_per_seed_and_fresh_across_seeds():
    assert generate_layout(7) == generate_layout(7)
    assert generate_layout(7) != generate_layout(8)


def test_layouts_stay_inside_the_area_and_cover_all_directions():
    for seed in range(300):
        tasks = generate_layout(seed)["tasks"]
        clicks = [t for t in tasks if t["kind"] == "click"]
        for c in clicks:
            assert MARGIN + c["r"] <= c["x"] <= AREA_W - MARGIN - c["r"]
            assert MARGIN + c["r"] <= c["y"] <= AREA_H - MARGIN - c["r"]
        octants = {
            round(math.degrees(math.atan2(b["y"] - a["y"], b["x"] - a["x"])) / 45) % 8
            for a, b in zip(clicks, clicks[1:])
        }
        assert octants == set(range(8))
        for d in (t for t in tasks if t["kind"] == "drag"):
            for end in (d["from"], d["to"]):
                assert 0 < end["x"] < AREA_W and 0 < end["y"] < AREA_H


def test_tracking_target_stays_in_the_area_and_starts_from_rest():
    track = generate_layout(3)["tasks"][-1]
    for ms in range(0, track["duration_ms"], 50):
        x, y = track_position(track, ms)
        assert 0 < x < AREA_W and 0 < y < AREA_H
    x0, y0 = track_position(track, 0)
    x1, y1 = track_position(track, 10)
    assert math.hypot(x1 - x0, y1 - y0) < 0.1


def _round(seed=5):
    layout = generate_layout(seed)
    events = simulate_round(layout, SyntheticProfile(), random.Random(seed))
    return layout, events, events[-1][0] + 500


def test_clean_round_replays_with_a_full_timeline():
    layout, events, elapsed = _round()
    result = replay_round(layout, events, elapsed)
    assert result.ok, result.reason
    assert [s["id"] for s in result.timeline] == [t["id"] for t in layout["tasks"]]
    assert result.timeline[-1]["coverage"] > 0.5


def test_trajectory_from_another_layout_is_rejected():
    _, old_events, elapsed = _round(seed=5)
    fresh_layout = generate_layout(6)
    result = replay_round(fresh_layout, old_events, elapsed)
    assert not result.ok and result.reason.startswith("target_not_hit")


def test_tampered_streams_are_rejected():
    layout, events, elapsed = _round()

    backwards = [list(e) for e in events]
    backwards[50][0] = backwards[49][0] - 5
    assert replay_round(layout, backwards, elapsed).reason == "timestamps_not_monotonic"

    assert replay_round(layout, events[:40], elapsed).reason == "event_count_out_of_bounds"

    # Submitting sooner than the events claim to have taken.
    assert replay_round(layout, events, 3000).reason == "client_clock_ahead_of_server"

    no_clicks = [e for e in events if e[3] == 0]
    assert replay_round(layout, no_clicks, elapsed).reason == "target_not_hit:c0"


def test_parking_the_pointer_does_not_count_as_tracking():
    layout, events, elapsed = _round()
    track = layout["tasks"][-1]
    result = replay_round(layout, events, elapsed)
    t0 = result.timeline[-1]["t_start"]
    parked = [e for e in events if e[0] <= t0]
    assert replay_round(layout, parked, elapsed).reason == f"tracking_not_followed:{track['id']}"
