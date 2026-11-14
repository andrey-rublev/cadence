/** One pointer sample on the wire: [t_ms, x, y, kind, buttons]. */
export type Sample = [t: number, x: number, y: number, kind: SampleKind, buttons: number]

export const MOVE = 0
export const DOWN = 1
export const UP = 2
export type SampleKind = typeof MOVE | typeof DOWN | typeof UP

export interface Circle {
  x: number
  y: number
  r: number
}

export interface ClickTask extends Circle {
  kind: 'click'
  id: string
}

export interface DragTask {
  kind: 'drag'
  id: string
  from: Circle
  to: Circle
}

export interface TrackTask {
  kind: 'track'
  id: string
  duration_ms: number
  ramp_ms: number
  r: number
  center: { x: number; y: number }
  amp: { x: number; y: number }
  freqs_hz: number[]
  weights: number[]
  phase_x: number[]
  phase_y: number[]
}

export type Task = ClickTask | DragTask | TrackTask

export interface Layout {
  version: number
  area: { w: number; h: number }
  tasks: Task[]
}

export interface ChallengeResult {
  events: Sample[]
  meta: { scale: number; dpr: number; pointer_type: string }
}
