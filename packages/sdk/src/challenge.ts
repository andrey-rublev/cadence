import { inside, trackPosition } from './geometry'
import { startRecorder } from './recorder'
import { DOWN, UP, type ChallengeResult, type Layout, type Sample } from './types'

/** Changes a few times per round; safe to put in UI state. */
export interface ChallengeView {
  /** Index of the active task. Equals `layout.tasks.length` once the round is complete. */
  taskIndex: number
  dragging: boolean
  tracking: boolean
  misses: number
}

/** Changes every animation frame; apply it straight to the DOM, not to UI state. */
export interface ChallengeFrame {
  /** Centre of the held token while a drag is in progress. */
  dragToken: { x: number; y: number } | null
  trackTarget: { x: number; y: number } | null
  trackProgress: number
}

export interface ChallengeHandlers {
  onView?: (view: ChallengeView) => void
  onFrame?: (frame: ChallengeFrame) => void
}

export interface ChallengeRun {
  /** Resolves when every task is complete. Never resolves if cancelled. */
  finished: Promise<ChallengeResult>
  cancel(): void
}

/** Hard bound on one round's samples; matches the server's limit. */
const MAX_EVENTS = 60_000

/**
 * Runs one challenge round on `element`, which must display `layout.area` at a uniform scale.
 *
 * Task completion follows the same rules as the server's replay
 * (backend/cadence/challenges/replay.py), applied to the same rounded samples, so the
 * server reaches the same timeline from the submitted events alone.
 */
export function runChallenge(
  element: HTMLElement,
  layout: Layout,
  handlers: ChallengeHandlers = {},
): ChallengeRun {
  const origin = performance.now()
  const events: Sample[] = []
  const tasks = layout.tasks

  let rect = element.getBoundingClientRect()
  let scale = rect.width / layout.area.w
  const measure = () => {
    rect = element.getBoundingClientRect()
    scale = rect.width / layout.area.w
  }
  const abort = new AbortController()
  window.addEventListener('resize', measure, { signal: abort.signal })
  window.addEventListener('scroll', measure, { signal: abort.signal, capture: true, passive: true })

  let index = 0
  let misses = 0
  let grab: { dx: number; dy: number } | null = null
  let trackStart: number | null = null
  let pointerX = 0
  let pointerY = 0
  let frameId = 0
  let trackTimer: ReturnType<typeof setTimeout> | undefined
  let resolve!: (result: ChallengeResult) => void
  const finished = new Promise<ChallengeResult>((r) => (resolve = r))

  const publish = () =>
    handlers.onView?.({
      taskIndex: index,
      dragging: grab !== null,
      tracking: trackStart !== null,
      misses,
    })

  const stop = () => {
    recorder.stop()
    abort.abort()
    cancelAnimationFrame(frameId)
    clearTimeout(trackTimer)
  }

  const advance = () => {
    index += 1
    grab = null
    publish()
    if (index >= tasks.length) {
      stop()
      resolve({
        events,
        meta: { scale, dpr: window.devicePixelRatio, pointer_type: recorder.pointerType },
      })
    }
  }

  const onSample = (sample: Sample) => {
    if (events.length >= MAX_EVENTS) return
    events.push(sample)
    const [t, x, y, kind] = sample
    pointerX = x
    pointerY = y
    const task = tasks[index]
    if (!task) return

    if (task.kind === 'click') {
      if (kind !== DOWN) return
      if (inside(x, y, task)) advance()
      else {
        misses += 1
        publish()
      }
    } else if (task.kind === 'drag') {
      if (kind === DOWN && !grab && inside(x, y, task.from)) {
        grab = { dx: task.from.x - x, dy: task.from.y - y }
        publish()
      } else if (kind === UP && grab) {
        if (inside(x, y, task.to)) advance()
        else {
          grab = null
          publish()
        }
      }
    } else if (trackStart === null && inside(x, y, { ...trackPosition(task, 0), r: task.r })) {
      trackStart = t
      // A timer, not the frame loop, ends the round: browsers pause animation frames in hidden tabs.
      trackTimer = setTimeout(advance, task.duration_ms)
      publish()
    }
  }

  const recorder = startRecorder({
    element,
    origin,
    toLocal: (cx, cy) => [(cx - rect.left) / scale, (cy - rect.top) / scale],
    onSample,
  })

  const frame = () => {
    const task = tasks[index]
    let trackTarget: ChallengeFrame['trackTarget'] = null
    let trackProgress = 0
    if (task?.kind === 'track') {
      const elapsed = trackStart === null ? 0 : performance.now() - origin - trackStart
      trackTarget = trackPosition(task, elapsed)
      trackProgress = Math.min(1, elapsed / task.duration_ms)
    }
    handlers.onFrame?.({
      dragToken: grab ? { x: pointerX + grab.dx, y: pointerY + grab.dy } : null,
      trackTarget,
      trackProgress,
    })
    frameId = requestAnimationFrame(frame)
  }

  publish()
  frameId = requestAnimationFrame(frame)
  return { finished, cancel: stop }
}
