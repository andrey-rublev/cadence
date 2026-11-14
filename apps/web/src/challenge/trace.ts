import type { Sample } from '@cadence/sdk'

const MAX_POINTS = 420

/** SVG path data for a recorded round, thinned to a few hundred points. */
export function tracePath(events: Sample[]): string {
  const step = Math.max(1, Math.ceil(events.length / MAX_POINTS))
  let d = ''
  for (let i = 0; i < events.length; i += step) {
    d += `${d ? 'L' : 'M'}${events[i][1]} ${events[i][2]}`
  }
  return d
}
