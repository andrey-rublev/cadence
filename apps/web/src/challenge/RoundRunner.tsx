import type { ChallengeResult, ChallengeView, IssuedChallenge, Layout } from '@cadence/sdk'
import { useState, type ReactNode } from 'react'

import { ChallengeSheet } from './ChallengeSheet'

function instruction(layout: Layout, view: ChallengeView | null): string {
  const task = view && layout.tasks[view.taskIndex]
  if (!task) return 'Saving this round'
  const before = layout.tasks.slice(0, view.taskIndex)
  if (task.kind === 'click') {
    if (view.taskIndex === 0) return 'Click the ore to break ground.'
    const total = layout.tasks.filter((t) => t.kind === 'click').length - 1
    return `Click each piece of ore as it appears. ${view.taskIndex} of ${total}`
  }
  if (task.kind === 'drag') {
    const n = before.filter((t) => t.kind === 'drag').length + 1
    const total = layout.tasks.filter((t) => t.kind === 'drag').length
    return `Drag the unearthed coin into the tray. ${n} of ${total}`
  }
  return view.tracking
    ? 'Keep your pointer on the drill until the bar fills.'
    : 'Move your pointer onto the drill to start tunnelling.'
}

/** Where the round stands: three stages, each a labelled bar. The live instruction says the same in words. */
function RoundProgress({ layout, view }: { layout: Layout; view: ChallengeView | null }) {
  const done = layout.tasks.slice(0, view?.taskIndex ?? 0)
  const count = (kind: string, of: Layout['tasks']) => of.filter((t) => t.kind === kind).length
  const stages = [
    // The first click only starts the round, so it is not one of the digs.
    { name: 'Dig', done: Math.max(0, count('click', done) - 1), total: count('click', layout.tasks) - 1 },
    { name: 'Recover', done: count('drag', done), total: count('drag', layout.tasks) },
    { name: 'Tunnel', done: count('track', done), total: 1 },
  ]
  return (
    <ol aria-hidden="true" className="grid grid-cols-[8fr_3fr_2fr] gap-2">
      {stages.map((stage) => (
        <li key={stage.name} className="grid gap-1">
          <span className="font-mono text-xs text-muted-foreground">
            {stage.name}
            {stage.total > 1 && ` ${stage.done}/${stage.total}`}
          </span>
          <span className="h-1 overflow-hidden rounded-full bg-rule">
            <span
              className="block h-full origin-left bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${stage.done / stage.total})` }}
            />
          </span>
        </li>
      ))}
    </ol>
  )
}

interface RoundRunnerProps {
  /** The issued round to play, or `null` between rounds. */
  challenge: IssuedChallenge | null
  /** Shown in place of the live instruction while no round is running. */
  idleText: string
  onComplete: (result: ChallengeResult) => void
  /** Drawn under the targets while idle (a previous round's trace). */
  underlay?: ReactNode
  /** Centred over the idle sheet: the prompt to start the next round. */
  children?: ReactNode
}

/**
 * One challenge round with its guidance: the live instruction, the stage progress and
 * the sheet. Used by collection, enrollment and verification so all three look and
 * behave the same. Renders three siblings; the parent supplies the spacing.
 */
export function RoundRunner({ challenge, idleText, onComplete, underlay, children }: RoundRunnerProps) {
  const [view, setView] = useState<ChallengeView | null>(null)
  return (
    <>
      <p aria-live="polite" className="min-h-7 text-lg">
        {challenge ? instruction(challenge.layout, view) : idleText}
      </p>
      {challenge && <RoundProgress layout={challenge.layout} view={view} />}
      <ChallengeSheet layout={challenge?.layout ?? null} onComplete={onComplete} onView={setView} underlay={underlay}>
        {children}
      </ChallengeSheet>
    </>
  )
}
