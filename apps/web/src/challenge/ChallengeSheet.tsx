import {
  runChallenge,
  trackPosition,
  type ChallengeResult,
  type ChallengeView,
  type Layout,
} from '@cadence/sdk'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Crate, DigSpot, Find, Hole, Mole } from './DigArt'

interface ChallengeSheetProps {
  /** The round to run. `null` shows an idle sheet. */
  layout: Layout | null
  onComplete: (result: ChallengeResult) => void
  onView?: (view: ChallengeView) => void
  /** Drawn under the targets, in sheet coordinates (a previous round's trace). */
  underlay?: ReactNode
  /** Centred over the sheet while no round is running. */
  children?: ReactNode
}

export const SHEET = { w: 800, h: 500 }

/** The tunnel behind the mole gains a point each time it has moved this far (px). */
const TUNNEL_STEP = 5

/**
 * The challenge surface, dressed as a dig site. The theme is cosmetic: geometry, hit
 * areas and rules come from the layout and the SDK, unchanged.
 *
 * Pointer capture happens only on this element and only while a round is running.
 * Per-frame positions go straight to the DOM; React state changes a handful of times
 * per round.
 */
export function ChallengeSheet({ layout, onComplete, onView, underlay, children }: ChallengeSheetProps) {
  const surface = useRef<HTMLDivElement>(null)
  const token = useRef<SVGGElement>(null)
  const target = useRef<SVGGElement>(null)
  const mole = useRef<SVGGElement>(null)
  const tunnel = useRef<SVGPolylineElement>(null)
  const progress = useRef<SVGRectElement>(null)
  const [view, setView] = useState<ChallengeView | null>(null)
  const callbacks = useRef({ onComplete, onView })
  useEffect(() => {
    callbacks.current = { onComplete, onView }
  })

  useEffect(() => {
    if (!layout || !surface.current) return
    let last: { x: number; y: number } | null = null
    let tunnelEnd: { x: number; y: number } | null = null
    let tunnelPoints = ''

    const run = runChallenge(surface.current, layout, {
      onView: (next) => {
        setView(next)
        callbacks.current.onView?.(next)
      },
      onFrame: ({ dragToken, trackTarget, trackProgress }) => {
        if (dragToken) token.current?.setAttribute('transform', `translate(${dragToken.x} ${dragToken.y})`)
        if (!trackTarget) return
        const { x, y } = trackTarget
        target.current?.setAttribute('transform', `translate(${x} ${y})`)
        progress.current?.setAttribute('width', String(trackProgress * SHEET.w))
        if (last && Math.hypot(x - last.x, y - last.y) > 0.2) {
          const heading = (Math.atan2(y - last.y, x - last.x) * 180) / Math.PI
          mole.current?.setAttribute('transform', `rotate(${heading})`)
        }
        last = trackTarget
        if (!tunnelEnd || Math.hypot(x - tunnelEnd.x, y - tunnelEnd.y) >= TUNNEL_STEP) {
          tunnelEnd = trackTarget
          tunnelPoints += `${x.toFixed(1)},${y.toFixed(1)} `
          tunnel.current?.setAttribute('points', tunnelPoints)
        }
      },
    })
    let cancelled = false
    run.finished.then((result) => {
      if (!cancelled) callbacks.current.onComplete(result)
    })
    return () => {
      cancelled = true
      run.cancel()
      setView(null)
    }
  }, [layout])

  const task = layout && view ? layout.tasks[view.taskIndex] : undefined
  const dug = layout && view ? layout.tasks.slice(0, view.taskIndex).filter((t) => t.kind === 'click') : []
  const trackOrigin = task?.kind === 'track' ? trackPosition(task, 0) : null
  const beckon =
    'origin-center animate-beckon fill-none stroke-primary stroke-2 [transform-box:fill-box] motion-reduce:hidden'

  return (
    <div
      ref={surface}
      aria-label="Challenge area"
      className="dig-site relative w-full max-w-[800px] touch-none overflow-hidden rounded-lg border border-earth/40 select-none"
      style={{ aspectRatio: `${SHEET.w} / ${SHEET.h}` }}
    >
      <svg viewBox={`0 0 ${SHEET.w} ${SHEET.h}`} className="absolute inset-0 size-full" aria-hidden="true">
        {underlay}

        {dug.map((spot) => (
          <g key={spot.id} transform={`translate(${spot.x} ${spot.y})`}>
            <Hole r={spot.r} />
          </g>
        ))}

        {task?.kind === 'click' && (
          <g key={task.id} transform={`translate(${task.x} ${task.y})`}>
            {view?.taskIndex === 0 && <circle r={task.r} className={beckon} />}
            <DigSpot r={task.r} />
          </g>
        )}

        {task?.kind === 'drag' && (
          <g key={task.id}>
            <g transform={`translate(${task.to.x} ${task.to.y})`}>
              <Crate r={task.to.r} />
            </g>
            <g
              ref={token}
              key={view?.dragging ? 'held' : 'resting'}
              transform={`translate(${task.from.x} ${task.from.y})`}
            >
              <Find r={task.from.r} held={view?.dragging ?? false} />
            </g>
          </g>
        )}

        {task?.kind === 'track' && trackOrigin && (
          <>
            <polyline
              ref={tunnel}
              className="fill-none stroke-pit/30"
              strokeWidth={task.r * 0.9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <g ref={target} transform={`translate(${trackOrigin.x} ${trackOrigin.y})`}>
              {!view?.tracking && <circle r={task.r} className={beckon} />}
              <g ref={mole}>
                <Mole r={task.r} />
              </g>
            </g>
            <rect ref={progress} x={0} y={SHEET.h - 5} width={0} height={5} className="fill-primary" />
          </>
        )}
      </svg>

      {!layout && children && (
        <div className="absolute inset-0 grid place-items-center p-4">{children}</div>
      )}
    </div>
  )
}
