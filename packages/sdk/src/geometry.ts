import type { Circle, TrackTask } from './types'

/** Must equal HIT_TOL_PX in backend/cadence/challenges/replay.py. */
export const HIT_TOL_PX = 2

export function inside(x: number, y: number, target: Circle): boolean {
  const dx = x - target.x
  const dy = y - target.y
  const reach = target.r + HIT_TOL_PX
  return dx * dx + dy * dy <= reach * reach
}

/**
 * Target centre `tMs` after tracking started.
 * Mirror of `track_position` in backend/cadence/challenges/spec.py; keep the two in step.
 */
export function trackPosition(task: TrackTask, tMs: number): { x: number; y: number } {
  const t = Math.max(0, Math.min(tMs, task.duration_ms))
  const ramp = task.ramp_ms
  const tauS = (t < ramp ? (t * t) / (2 * ramp) : t - ramp / 2) / 1000
  const total = task.weights.reduce((a, b) => a + b, 0)
  const axis = (phases: number[], centre: number, amp: number) => {
    let s = 0
    for (let k = 0; k < task.weights.length; k++) {
      s += task.weights[k] * Math.sin(2 * Math.PI * task.freqs_hz[k] * tauS + phases[k])
    }
    return centre + (amp * s) / total
  }
  return {
    x: axis(task.phase_x, task.center.x, task.amp.x),
    y: axis(task.phase_y, task.center.y, task.amp.y),
  }
}
