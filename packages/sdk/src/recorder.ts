import { DOWN, MOVE, UP, type Sample, type SampleKind } from './types'

export interface RecorderOptions {
  /** Pointer events are captured on this element only. Nothing outside it is observed. */
  element: HTMLElement
  /** Maps viewport coordinates into the caller's coordinate space. */
  toLocal: (clientX: number, clientY: number) => [number, number]
  /** `performance.now()` value that counts as t = 0. */
  origin: number
  onSample: (sample: Sample) => void
}

export interface Recorder {
  /** Pointer type of the first sample seen ('mouse', 'pen', 'touch'), or '' before any. */
  readonly pointerType: string
  stop(): void
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Moves closer together than this are dropped (a 250 Hz ceiling). It bounds payload
 * size on high-polling-rate mice and keeps the hardware's polling rate out of the data.
 */
const MIN_MOVE_INTERVAL_MS = 4

/**
 * Records pointer samples at the highest rate the browser offers.
 *
 * Browsers deliver `pointermove` about once per frame. Where available (secure
 * contexts, Chromium) `pointerrawupdate` and `getCoalescedEvents()` expose the samples
 * in between. Keyboard input is never observed.
 */
export function startRecorder({ element, toLocal, origin, onSample }: RecorderOptions): Recorder {
  let lastT = 0
  let lastMoveT = -Infinity
  let pointerType = ''
  const abort = new AbortController()
  const listen = { signal: abort.signal, passive: true }

  const emit = (e: PointerEvent, kind: SampleKind) => {
    if (!e.isPrimary) return
    if (kind !== MOVE && e.button !== 0) return
    // Coalesced samples can carry timestamps slightly behind the previous event.
    const t = Math.max(lastT, round1(e.timeStamp - origin), 0)
    if (kind === MOVE) {
      if (t - lastMoveT < MIN_MOVE_INTERVAL_MS) return
      lastMoveT = t
    }
    lastT = t
    pointerType ||= e.pointerType
    const [x, y] = toLocal(e.clientX, e.clientY)
    onSample([t, round1(x), round1(y), kind, e.buttons])
  }

  const onMove = (e: PointerEvent) => {
    const parts = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    if (parts.length > 1) for (const part of parts) emit(part, MOVE)
    else emit(e, MOVE)
  }

  const raw = 'onpointerrawupdate' in element
  element.addEventListener(raw ? 'pointerrawupdate' : 'pointermove', onMove as EventListener, listen)
  element.addEventListener(
    'pointerdown',
    (e) => {
      // Keep receiving this pointer while a drag leaves the element.
      if (e.isPrimary) element.setPointerCapture(e.pointerId)
      emit(e, DOWN)
    },
    listen,
  )
  element.addEventListener('pointerup', (e) => emit(e, UP), listen)
  element.addEventListener('pointercancel', (e) => emit(e, UP), listen)

  return {
    get pointerType() {
      return pointerType
    },
    stop: () => abort.abort(),
  }
}
