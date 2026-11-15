/**
 * Keyboard zones. Mirrors backend/cadence/features/keys.py; change both together.
 *
 * Every physical key is reduced to a coarse zone (which hand and which row, or space,
 * backspace, enter, modifier) here in the browser, so what leaves the page cannot be turned
 * back into text. Keys typed into password fields are reported as SECRET: timing only.
 */

export const HIDDEN = 0
export const SPACE = 9
export const BACKSPACE = 10
export const ENTER = 11
export const MODIFIER = 12
/** A press inside a password or code field: timing only, compared key by key between sign-ins. */
export const SECRET = 13

const ROWS: Record<number, string> = {
  1: '`12345',
  2: 'qwert',
  3: 'asdfg',
  4: 'zxcvb',
  5: '67890-=',
  6: 'yuiop[]\\',
  7: "hjkl;'",
  8: 'nm,./',
}
const CHAR_ZONE = new Map<string, number>(
  Object.entries(ROWS).flatMap(([zone, chars]) => [...chars].map((ch) => [ch, Number(zone)] as const)),
)
const CODE_CHAR: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
}
const SPECIAL: Record<string, number> = { Space: SPACE, Backspace: BACKSPACE, Enter: ENTER, NumpadEnter: ENTER }
const MODIFIERS = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'CapsLock',
  'MetaLeft',
  'MetaRight',
])

/** Zone of a physical key from `KeyboardEvent.code`. */
export function zoneOfCode(code: string): number {
  if (code in SPECIAL) return SPECIAL[code]
  if (MODIFIERS.has(code)) return MODIFIER
  if (code.startsWith('Key') && code.length === 4) return CHAR_ZONE.get(code[3].toLowerCase()) ?? HIDDEN
  if (code.startsWith('Digit') && code.length === 6) return CHAR_ZONE.get(code[5]) ?? HIDDEN
  return CHAR_ZONE.get(CODE_CHAR[code] ?? '') ?? HIDDEN
}

/**
 * Zone of a key event, or HIDDEN for secrets: password fields, one-time codes, and anything
 * marked `data-cadence-private` keep only their timing.
 */
export function zoneOfEvent(e: KeyboardEvent): number {
  const target = e.target as HTMLInputElement | null
  const secret =
    target?.tagName === 'INPUT' &&
    (target.type === 'password' || target.autocomplete === 'one-time-code' || 'cadencePrivate' in target.dataset)
  if (!secret) return zoneOfCode(e.code)
  // Leaving the field (Enter, Tab) says nothing about the secret, and ends its run of presses.
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return ENTER
  if (e.code === 'Tab') return HIDDEN
  return SECRET
}
