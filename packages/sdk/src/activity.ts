import { MODIFIER, zoneOfKeySample } from './keys'
import type { KeySample } from './passive'
import { DOWN, MOVE, UP, type Sample } from './types'

/** Whatever a page saw: key timing (zones only) and pointer samples, on one clock. */
export interface Activity {
  keys: KeySample[]
  pointer: Sample[]
}

export interface ActivityCounts {
  keys: number
  clicks: number
}

export interface ActivityRecorder {
  /** Everything recorded so far, oldest event at t = 0. */
  snapshot(): Activity
  counts(): ActivityCounts
  /** Forget what was recorded (after it was sent). */
  reset(): void
  stop(): void
}

export interface ActivityOptions {
  /** Only input inside this element is observed. Defaults to the whole document. */
  root?: HTMLElement
  onChange?: (counts: ActivityCounts) => void
  /** Older events are dropped so a long visit stays bounded. Default 10 minutes. */
  keepMs?: number
}

export interface EvidenceReceipt {
  /** Opaque, single use, short-lived. Hand it to your server; your server asks Cadence for the decision. */
  token: string
  keys: number
  clicks: number
}

/**
 * For partner sites: send what this page recorded straight to Cadence and get back an
 * evidence token. Your server never handles the timing data, only the token.
 */
export async function sendEvidence(
  recorder: ActivityRecorder,
  { siteKey, endpoint }: { siteKey: string; endpoint: string },
): Promise<EvidenceReceipt> {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/v1/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cadence-Site': siteKey },
    body: JSON.stringify(recorder.snapshot()),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(`cadence_evidence_failed:${(detail as { detail?: string }).detail ?? response.status}`)
  }
  recorder.reset()
  return response.json()
}

const MAX_KEYS = 3_000
const MAX_POINTER = 30_000
const MIN_MOVE_INTERVAL_MS = 4
const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Record ordinary activity with no windows and no minimum: the typing and clicking someone
 * does while signing in or working. Used where the decision has to be made from whatever
 * happened, such as a partner's sign-in form. Characters are never recorded.
 */
export function recordActivity({ root, onChange, keepMs = 10 * 60_000 }: ActivityOptions = {}): ActivityRecorder {
  const target: HTMLElement | Document = root ?? document
  const abort = new AbortController()
  const listen = { signal: abort.signal, passive: true, capture: true }
  // Absolute event.timeStamp values; made relative on snapshot.
  let keys: KeySample[] = []
  let pointer: Sample[] = []
  let lastMove = -Infinity
  const held = new Map<string, number>()

  const counts = (): ActivityCounts => ({
    keys: keys.filter(([, kind, zone]) => kind === 1 && zone !== MODIFIER).length,
    clicks: pointer.filter(([, , , kind]) => kind === DOWN).length,
  })
  const changed = () => onChange?.(counts())
  const trim = (now: number) => {
    keys = keys.filter(([t]) => now - t <= keepMs).slice(-MAX_KEYS)
    pointer = pointer.filter(([t]) => now - t <= keepMs).slice(-MAX_POINTER)
  }

  const onPointer = (e: PointerEvent, kind: Sample[3]) => {
    if (!e.isPrimary || e.pointerType === 'touch') return
    if (kind !== MOVE && e.button !== 0) return
    if (kind === MOVE) {
      if (e.timeStamp - lastMove < MIN_MOVE_INTERVAL_MS) return
      lastMove = e.timeStamp
    }
    pointer.push([e.timeStamp, round1(e.clientX), round1(e.clientY), kind, e.buttons])
    if (pointer.length > MAX_POINTER) trim(e.timeStamp)
    if (kind === DOWN) changed()
  }
  const onMove = (e: PointerEvent) => {
    const parts = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    if (parts.length > 1) for (const part of parts) onPointer(part, MOVE)
    else onPointer(e, MOVE)
  }
  const onKey = (e: KeyboardEvent, kind: 1 | 2) => {
    const zone = zoneOfKeySample(e, kind, held)
    if (zone === null) return
    keys.push([e.timeStamp, kind, zone])
    if (keys.length > MAX_KEYS) trim(e.timeStamp)
    if (kind === 1) changed()
  }

  const raw = 'onpointerrawupdate' in target
  target.addEventListener(raw ? 'pointerrawupdate' : 'pointermove', onMove as EventListener, listen)
  target.addEventListener('pointerdown', ((e: PointerEvent) => onPointer(e, DOWN)) as EventListener, listen)
  target.addEventListener('pointerup', ((e: PointerEvent) => onPointer(e, UP)) as EventListener, listen)
  target.addEventListener('keydown', ((e: KeyboardEvent) => onKey(e, 1)) as EventListener, listen)
  target.addEventListener('keyup', ((e: KeyboardEvent) => onKey(e, 2)) as EventListener, listen)
  window.addEventListener('blur', () => held.clear(), { signal: abort.signal })

  return {
    snapshot() {
      trim(performance.now())
      const origin = Math.min(keys[0]?.[0] ?? Infinity, pointer[0]?.[0] ?? Infinity)
      // Relative, rounded, and never decreasing (coalesced pointer events can arrive slightly out of order).
      const clock = () => {
        let last = 0
        return (t: number) => (last = Math.max(last, round1(t - (Number.isFinite(origin) ? origin : 0))))
      }
      const keyAt = clock()
      const pointerAt = clock()
      return {
        keys: keys.map(([t, kind, zone]) => [keyAt(t), kind, zone] as KeySample),
        pointer: pointer.map(([t, x, y, kind, buttons]) => [pointerAt(t), x, y, kind, buttons] as Sample),
      }
    },
    counts,
    reset() {
      keys = []
      pointer = []
      held.clear()
      changed()
    },
    stop: () => abort.abort(),
  }
}
