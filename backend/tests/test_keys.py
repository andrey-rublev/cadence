"""Keyboard zones and timing features. The browser and the server must map keys identically."""

import re

import numpy as np

from cadence.core.config import REPO_ROOT
from cadence.features import keys
from cadence.features.keys import (
    HIDDEN,
    KEY_FEATURE_NAMES,
    MODIFIER,
    SPACE,
    presses_from_events,
    window_vector,
    windows,
    zone_of_code,
    zone_of_keycode,
)


def test_browser_zone_table_mirrors_the_server():
    source = (REPO_ROOT / "packages" / "sdk" / "src" / "keys.ts").read_text()
    block = re.search(r"const ROWS[^{]*\{(.*?)\n\}", source, re.S).group(1)
    ts_rows = {int(z): eval(chars) for z, chars in re.findall(r"(\d+): ('.*?'|\".*?\")", block)}  # noqa: S307
    assert ts_rows == keys._ROWS


def test_physical_codes_and_legacy_keycodes_agree():
    for letter in "abcdefghijklmnopqrstuvwxyz":
        assert zone_of_code(f"Key{letter.upper()}") == zone_of_keycode(ord(letter.upper())) != HIDDEN
    for digit in "0123456789":
        assert zone_of_code(f"Digit{digit}") == zone_of_keycode(ord(digit)) != HIDDEN
    assert zone_of_code("Space") == zone_of_keycode(32) == SPACE
    assert zone_of_code("ShiftLeft") == zone_of_keycode(16) == MODIFIER
    assert zone_of_code("F5") == HIDDEN


def test_zones_never_identify_a_key():
    """Every zone covers several keys, so a sequence of zones cannot be read back as text."""
    sizes = [len(chars) for chars in keys._ROWS.values()]
    assert min(sizes) >= 4


def test_features_from_a_steady_typist():
    events, t = [], 0.0
    for i in range(60):
        zone = (3, 7, 9)[i % 3]
        events += [[t, 1, zone], [t + 90, 2, zone]]
        t += 150
    presses = presses_from_events(events)
    assert len(presses) == 60
    chunk = windows(presses, 50)[0]
    vector = dict(zip(KEY_FEATURE_NAMES, window_vector(chunk)))
    assert vector["hold_med"] == 90 and vector["dd_med"] == 150 and vector["ud_med"] == 60
    assert vector["rollover_rate"] == 0 and vector["pause_rate"] == 0
    assert np.isnan(vector["hold_modifier_med"])  # no modifier pressed
