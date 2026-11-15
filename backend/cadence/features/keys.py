"""Keystroke timing features. Characters are never needed, stored or sent.

The browser reduces every physical key to a coarse zone (which hand and which keyboard row,
or space / backspace / enter / modifier) before anything leaves the page, so a recording
cannot be turned back into text. Inside password fields even the zone is dropped and only
timing is kept: those presses arrive as SECRET, which these features treat like any key whose
zone is unknown (see rhythm.py for how they are compared between sign-ins). Features are timings between and within presses, grouped by those zones.

A press is (t_down_ms, t_up_ms, zone).
"""

import math

import numpy as np

KEY_SCHEMA = 1
PAUSE_MS = 1500  # a gap this long ends a burst of typing and is counted as a pause, not a flight

ZONE_NAMES = (
    "hidden", "left-number", "left-top", "left-home", "left-bottom",
    "right-number", "right-top", "right-home", "right-bottom",
    "space", "backspace", "enter", "modifier", "secret",
)  # fmt: skip
HIDDEN, SPACE, BACKSPACE, ENTER, MODIFIER, SECRET = 0, 9, 10, 11, 12, 13
MAX_ZONE = SECRET
LEFT, RIGHT = frozenset({1, 2, 3, 4}), frozenset({5, 6, 7, 8})

_ROWS = {
    1: "`12345", 2: "qwert", 3: "asdfg", 4: "zxcvb",
    5: "67890-=", 6: "yuiop[]\\", 7: "hjkl;'", 8: "nm,./",
}  # fmt: skip
_CHAR_ZONE = {ch: zone for zone, chars in _ROWS.items() for ch in chars}
# KeyboardEvent.code names for punctuation keys (letters are "KeyA", digits "Digit1").
_CODE_CHAR = {
    "Backquote": "`", "Minus": "-", "Equal": "=", "BracketLeft": "[", "BracketRight": "]",
    "Backslash": "\\", "Semicolon": ";", "Quote": "'", "Comma": ",", "Period": ".", "Slash": "/",
}  # fmt: skip
# Legacy keyCode values (used by the Aalto dataset) for the same punctuation keys.
_KEYCODE_CHAR = {192: "`", 189: "-", 187: "=", 219: "[", 221: "]", 220: "\\", 186: ";", 222: "'", 188: ",", 190: ".", 191: "/"}
_SPECIAL_CODE = {"Space": SPACE, "Backspace": BACKSPACE, "Enter": ENTER, "NumpadEnter": ENTER}
_MODIFIER_CODES = {"ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "CapsLock", "MetaLeft", "MetaRight"}


def zone_of_code(code: str) -> int:
    """Zone of a physical key from KeyboardEvent.code. Mirrored in packages/sdk/src/keys.ts."""
    if code in _SPECIAL_CODE:
        return _SPECIAL_CODE[code]
    if code in _MODIFIER_CODES:
        return MODIFIER
    if code.startswith("Key") and len(code) == 4:
        return _CHAR_ZONE.get(code[3].lower(), HIDDEN)
    if code.startswith("Digit") and len(code) == 6:
        return _CHAR_ZONE.get(code[5], HIDDEN)
    return _CHAR_ZONE.get(_CODE_CHAR.get(code, ""), HIDDEN)


def zone_of_keycode(keycode: int) -> int:
    """Zone from a legacy keyCode, assuming a QWERTY layout (the Aalto dataset)."""
    if keycode == 32:
        return SPACE
    if keycode == 8:
        return BACKSPACE
    if keycode == 13:
        return ENTER
    if keycode in (16, 17, 18, 20, 91, 92, 93):
        return MODIFIER
    if 65 <= keycode <= 90:
        return _CHAR_ZONE.get(chr(keycode).lower(), HIDDEN)
    if 48 <= keycode <= 57:
        return _CHAR_ZONE.get(chr(keycode), HIDDEN)
    return _CHAR_ZONE.get(_KEYCODE_CHAR.get(keycode, ""), HIDDEN)


def presses_from_events(events: list) -> list[tuple[float, float, int]]:
    """Pair [t_ms, kind, zone] events (kind 1 down, 2 up) into presses, first-in first-out per zone."""
    open_downs: dict[int, list[float]] = {}
    presses = []
    for t, kind, zone in sorted(events, key=lambda e: e[0]):
        if kind == 1:
            open_downs.setdefault(int(zone), []).append(float(t))
        elif kind == 2 and open_downs.get(int(zone)):
            presses.append((open_downs[int(zone)].pop(0), float(t), int(zone)))
    return sorted(presses)


def _hand(zone: int) -> str | None:
    return "L" if zone in LEFT else "R" if zone in RIGHT else None


def _med(values: list[float]) -> float:
    return float(np.median(values)) if values else math.nan


def _iqr(values: list[float]) -> float:
    return float(np.subtract(*np.percentile(values, [75, 25]))) if len(values) >= 4 else math.nan


KEY_FEATURE_NAMES: tuple[str, ...] = (
    "hold_med", "hold_iqr", "hold_space_med", "hold_modifier_med",
    "dd_med", "dd_iqr", "dd_p90_ratio", "ud_med", "ud_iqr", "rollover_rate",
    "dd_cross_hand_med", "dd_same_hand_med", "dd_into_space_med", "dd_out_of_space_med",
    "backspace_rate", "pause_rate",
)  # fmt: skip


def window_vector(presses: list[tuple[float, float, int]]) -> np.ndarray:
    """Timing features over a window of presses (typically 50 keys)."""
    typing = [p for p in presses if p[2] != MODIFIER]
    holds = [up - down for down, up, _ in typing if up >= down]
    pairs = list(zip(typing, typing[1:]))
    flights = [(a, b, b[0] - a[0], b[0] - a[1]) for a, b in pairs if b[0] - a[0] < PAUSE_MS]
    dd = [f[2] for f in flights]
    ud = [f[3] for f in flights]
    cross = [f[2] for f in flights if _hand(f[0][2]) and _hand(f[1][2]) and _hand(f[0][2]) != _hand(f[1][2])]
    same = [f[2] for f in flights if _hand(f[0][2]) and _hand(f[0][2]) == _hand(f[1][2])]
    values = {
        "hold_med": _med(holds),
        "hold_iqr": _iqr(holds),
        "hold_space_med": _med([u - d for d, u, z in typing if z == SPACE]),
        "hold_modifier_med": _med([u - d for d, u, z in presses if z == MODIFIER]),
        "dd_med": _med(dd),
        "dd_iqr": _iqr(dd),
        "dd_p90_ratio": float(np.percentile(dd, 90) / np.median(dd)) if len(dd) >= 10 and np.median(dd) > 0 else math.nan,
        "ud_med": _med(ud),
        "ud_iqr": _iqr(ud),
        "rollover_rate": float(np.mean([u < 0 for u in ud])) if ud else math.nan,
        "dd_cross_hand_med": _med(cross),
        "dd_same_hand_med": _med(same),
        "dd_into_space_med": _med([f[2] for f in flights if f[1][2] == SPACE]),
        "dd_out_of_space_med": _med([f[2] for f in flights if f[0][2] == SPACE]),
        "backspace_rate": sum(z == BACKSPACE for _, _, z in typing) / len(typing) if typing else math.nan,
        "pause_rate": sum(b[0] - a[0] >= PAUSE_MS for a, b in pairs) / len(pairs) if pairs else math.nan,
    }
    return np.array([values[name] for name in KEY_FEATURE_NAMES], dtype=float)


def windows(presses: list[tuple[float, float, int]], size: int) -> list[list[tuple[float, float, int]]]:
    """Consecutive, non-overlapping windows of `size` typing presses (modifiers ride along)."""
    out, current, count = [], [], 0
    for p in presses:
        current.append(p)
        count += p[2] != MODIFIER
        if count == size:
            out.append(current)
            current, count = [], 0
    return out
