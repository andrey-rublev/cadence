import type { ChallengeResult, ChallengeView, IssuedChallenge, Layout } from '@cadence/sdk'
import { useState } from 'react'

import { ChallengeSheet, SHEET } from '@/challenge/ChallengeSheet'
import { tracePath } from '@/challenge/trace'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, explain, type CollectStatus, type SubmitResult } from '@/lib/api'

/** `null` marks a round recorded before this page was loaded, whose trace we no longer hold. */
type Trace = string | null

function instruction(layout: Layout, view: ChallengeView | null): string {
  const task = view && layout.tasks[view.taskIndex]
  if (!task) return 'Saving this round…'
  const before = layout.tasks.slice(0, view.taskIndex)
  if (task.kind === 'click') {
    if (view.taskIndex === 0) return 'Click the marked spot to break ground.'
    const total = layout.tasks.filter((t) => t.kind === 'click').length - 1
    return `Dig each marked spot as it appears. ${view.taskIndex} of ${total}`
  }
  if (task.kind === 'drag') {
    const n = before.filter((t) => t.kind === 'drag').length + 1
    const total = layout.tasks.filter((t) => t.kind === 'drag').length
    return `Drag the gold nugget into the crate. ${n} of ${total}`
  }
  return view.tracking
    ? 'Keep your pointer on the mole until the bar fills.'
    : 'Move onto the mole. It starts tunnelling when you touch it.'
}

function TraceStrip({ traces, slots }: { traces: Trace[]; slots: number }) {
  return (
    <ol className="flex gap-1.5" aria-label={`${traces.length} of ${slots} rounds recorded`}>
      {Array.from({ length: slots }, (_, i) => {
        const done = i < traces.length
        return (
          <li
            key={i}
            className={`relative h-9 w-14 overflow-hidden rounded-sm border ${done ? 'border-foreground/60 bg-card' : 'border-dashed border-rule'}`}
          >
            {done && traces[i] && (
              <svg viewBox={`0 0 ${SHEET.w} ${SHEET.h}`} className="size-full" aria-hidden="true">
                <path d={traces[i]} className="fill-none stroke-foreground" strokeWidth="9" strokeLinejoin="round" />
              </svg>
            )}
            {done && !traces[i] && <span className="absolute inset-0 m-auto size-1.5 rounded-full bg-foreground" />}
            {i === 0 && !done && (
              <span className="absolute inset-0 grid place-items-center font-mono text-[0.6875rem] text-muted-foreground">
                trial
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

interface SessionScreenProps {
  status: CollectStatus
  onStatus: (status: CollectStatus) => void
  onExit: () => void
}

export function SessionScreen({ status, onStatus, onExit }: SessionScreenProps) {
  const [challenge, setChallenge] = useState<IssuedChallenge | null>(null)
  const [view, setView] = useState<ChallengeView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [traces, setTraces] = useState<Trace[]>(() =>
    Array<Trace>(status.rounds_done + (status.warmup_done ? 1 : 0)).fill(null),
  )

  const practice = !status.warmup_done
  const roundName = practice ? 'Practice round' : `Round ${status.rounds_done + 1} of ${status.rounds_total}`
  const lastTrace = traces.at(-1)

  async function startRound() {
    setBusy(true)
    setError(null)
    try {
      setChallenge(await api.issueChallenge())
    } catch (e) {
      setError(explain(e))
    }
    setBusy(false)
  }

  async function finishRound(result: ChallengeResult) {
    const id = challenge!.id
    setChallenge(null)
    setView(null)
    setBusy(true)
    try {
      const saved = await api.submitChallenge<SubmitResult>(id, result)
      setTraces((all) => [...all, tracePath(result.events)])
      onStatus(saved.collect!)
    } catch (e) {
      setError(explain(e))
    }
    setBusy(false)
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="font-mono text-sm text-muted-foreground">
            {status.participant_code} · session {status.label}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">{roundName}</h1>
        </div>
        <TraceStrip traces={traces} slots={status.rounds_total + 1} />
      </div>

      <p aria-live="polite" className="min-h-7 text-lg">
        {challenge
          ? instruction(challenge.layout, view)
          : practice
            ? 'A practice round first. It is recorded but never scored.'
            : 'Each round has a new layout. Move the way you normally would.'}
      </p>

      <ChallengeSheet
        layout={challenge?.layout ?? null}
        onComplete={finishRound}
        onView={setView}
        underlay={
          !challenge &&
          lastTrace && (
            <path
              key={traces.length}
              d={lastTrace}
              pathLength={1}
              className="animate-draw fill-none stroke-earth/45 [stroke-dasharray:1] motion-reduce:animate-none"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          )
        }
      >
        <div className="grid max-w-sm justify-items-center gap-4 rounded-xl border border-rule bg-card/95 p-6 text-center shadow-sm">
          {lastTrace && !error && (
            <p className="text-sm text-muted-foreground">
              Behind this card are your tracks from the last round, exactly as they were recorded.
            </p>
          )}
          {error ? (
            <Alert variant="destructive" role="alert" className="text-left">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <p>Dig eight spots, crate three nuggets, then follow a mole for six seconds. About 20 seconds.</p>
          )}
          <Button size="lg" onClick={startRound} disabled={busy} className="h-12 px-6 text-base">
            {busy ? 'One moment…' : `Start ${roundName.toLowerCase()}`}
          </Button>
        </div>
      </ChallengeSheet>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>Recorded: pointer position and clicks inside the dig site, only while a round runs.</p>
        <Button variant="link" onClick={onExit} className="h-auto p-0 text-sm text-muted-foreground underline">
          I can't do this, or I want to stop
        </Button>
      </div>
    </div>
  )
}
