import { MODIFIER, zoneOfKeySample } from './keys'
import { DOWN, MOVE, UP, type Sample } from './types'

/** One key event on the wire: [t_ms, kind (1 down, 2 up), zone]. Never a character. */
export type KeySample = [t: number, kind: 1 | 2, zone: number]

export type PassiveWindow =
  | { modality: 'pointer'; events: Sample[]; duration_ms: number }
  | { modality: 'keys'; events: KeySample[]; duration_ms: number }

export interface PassiveProgress {
  /** Strokes (movements ending in a press) collected towards the next pointer window. */
  strokes: number
  /** Key presses collected towards the next keyboard window. */
  keys: number
}

export interface PassiveOptions {
  /** Only input inside this element is observed. */
  root: HTMLElement
  onWindow: (window: PassiveWindow) => void
  onProgress?: (progress: PassiveProgress) => void
  /** Strokes per pointer window. 12 is about one challenge round of pointing. */
  strokes?: number
  /** Key presses per keyboard window. */
  keys?: number
}

export interface PassiveCapture {
  stop(): void
}

const round1 = (v: number) => Math.round(v * 10) / 10
const MIN_MOVE_INTERVAL_MS = 4
/** A window that takes longer than this is discarded: the gaps would dominate it. */
const MAX_WINDOW_MS = 10 * 60_000
/** Hard cap on buffered pointer samples, so memory and payload stay bounded. */
const MAX_SAMPLES = 40_000

/**
 * Passive capture while someone uses the app: no task, no game.
 *
 * Pointer movement and key timing inside `root` are cut into windows and handed to
 * `onWindow`. Callers must have the user's consent before starting, and should show that
 * capture is on with a way to pause it.
 */
export function startPassive({ root, onWindow, onProgress, strokes = 12, keys = 50 }: PassiveOptions): PassiveCapture {
  const abort = new AbortController()
  const listen = { signal: abort.signal, passive: true, capture: true }

  let pointer: Sample[] = []
  let pointerOrigin = 0
  let pointerStrokes = 0
  let lastMoveT = -Infinity

  let keyEvents: KeySample[] = []
  let keyOrigin = 0
  let keyPresses = 0
  const held = new Map<string, number>()

  const progress = () => onProgress?.({ strokes: pointerStrokes, keys: keyPresses })

  const pointerSample = (e: PointerEvent, kind: Sample[3]) => {
    if (!e.isPrimary || e.pointerType === 'touch') return
    if (kind !== MOVE && e.button !== 0) return
    if (!pointer.length) pointerOrigin = e.timeStamp
    const t = Math.max(round1(e.timeStamp - pointerOrigin), pointer.at(-1)?.[0] ?? 0)
    if (t > MAX_WINDOW_MS || pointer.length >= MAX_SAMPLES) {
      pointer = []
      pointerStrokes = 0
      return
    }
    if (kind === MOVE) {
      if (t - lastMoveT < MIN_MOVE_INTERVAL_MS) return
      lastMoveT = t
    }
    pointer.push([t, round1(e.clientX), round1(e.clientY), kind, e.buttons])
    if (kind === DOWN) {
      pointerStrokes += 1
      progress()
    }
    if (kind === UP && pointerStrokes >= strokes) {
      onWindow({ modality: 'pointer', events: pointer, duration_ms: t })
      pointer = []
      pointerStrokes = 0
      lastMoveT = -Infinity
      progress()
    }
  }

  const onMove = (e: PointerEvent) => {
    const parts = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    if (parts.length > 1) for (const part of parts) pointerSample(part, MOVE)
    else pointerSample(e, MOVE)
  }

  const keySample = (e: KeyboardEvent, kind: 1 | 2) => {
    const zone = zoneOfKeySample(e, kind, held)
    if (zone === null) return
    if (!keyEvents.length) keyOrigin = e.timeStamp
    const t = Math.max(round1(e.timeStamp - keyOrigin), keyEvents.at(-1)?.[0] ?? 0)
    if (t > MAX_WINDOW_MS) {
      keyEvents = []
      keyPresses = 0
      return
    }
    keyEvents.push([t, kind, zone])
    if (kind === 1 && zone !== MODIFIER) {
      keyPresses += 1
      progress()
    }
    if (kind === 2 && keyPresses >= keys && held.size === 0) {
      onWindow({ modality: 'keys', events: keyEvents, duration_ms: t })
      keyEvents = []
      keyPresses = 0
      progress()
    }
  }

  const raw = 'onpointerrawupdate' in root
  root.addEventListener(raw ? 'pointerrawupdate' : 'pointermove', onMove as EventListener, listen)
  root.addEventListener('pointerdown', (e) => pointerSample(e, DOWN), listen)
  root.addEventListener('pointerup', (e) => pointerSample(e, UP), listen)
  root.addEventListener('keydown', (e) => keySample(e, 1), listen)
  root.addEventListener('keyup', (e) => keySample(e, 2), listen)
  // Keys released while the window is in the background never send keyup.
  window.addEventListener('blur', () => held.clear(), { signal: abort.signal })

  return { stop: () => abort.abort() }
}
