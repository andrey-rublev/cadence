import { ArrowRight, Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Progress } from '@/components/Shell'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, explain } from '@/lib/api'
import type { Me, SetupStep } from '@/lib/product'
import { KEYS_PER_WINDOW, STROKES_PER_WINDOW, usePassive, type LastSample } from '@/product/PassiveCapture'

import { SENTENCES, SentenceTest, TargetTest } from './tests'

type StepId = 'consent' | 'clicks' | 'typing'

const STEPS: { id: StepId; title: string }[] = [
  { id: 'consent', title: 'Consent' },
  { id: 'clicks', title: 'Click test' },
  { id: 'typing', title: 'Typing test' },
]

const SENTENCE_KEYS = Math.round(SENTENCES.reduce((sum, s) => sum + s.length, 0) / SENTENCES.length)

const done = (s: SetupStep) => s.done >= s.needed

function currentStep(me: Me): StepId | 'done' {
  if (!me.consent) return 'consent'
  if (!done(me.setup.steps.clicks)) return 'clicks'
  if (!done(me.setup.steps.typing)) return 'typing'
  return 'done'
}

/** How far a step has got, from 0 to 1, counting input towards the sample in progress. */
function fraction(step: SetupStep, pending: number, perSample: number): number {
  if (done(step)) return 1
  return (step.done * perSample + Math.min(pending, perSample)) / (step.needed * perSample)
}

/** Progress that never moves back: the pending count empties for a moment while a sample is saved. */
function useHighWater(value: number): number {
  const [high, setHigh] = useState(value)
  if (value > high) setHigh(value)
  return Math.max(high, value)
}

const NOT_COUNTED: Record<string, string> = {
  too_little_movement: 'Those clicks had too little pointer movement to count. Keep going.',
  too_little_typing: 'That stretch had too little typing to count. Keep going.',
}

/** Says so when the last sample of this kind was turned away, so a stalled bar is explained. */
function notCounted(last: LastSample | null, modality: LastSample['modality']): string | null {
  if (last?.purpose !== 'rejected' || last.modality !== modality) return null
  return NOT_COUNTED[last.code ?? ''] ?? 'The last sample could not be saved. Keep going.'
}

interface SetupProps {
  me: Me
  onMe: (me: Me) => void
  /** Leave setup for the dashboard, from the closing screen. */
  onFinish: () => void
}

/** Three short steps on the Cadence site collect what partner sites will be checked against. */
export function Setup({ me, onMe, onFinish }: SetupProps) {
  const active = currentStep(me)
  // The last sample usually lands mid-sentence; the sentence is finished before moving on.
  const [midSentence, setMidSentence] = useState(false)
  const view = active === 'done' && midSentence ? 'typing' : active

  const finished: Record<StepId, boolean> = {
    consent: me.consent,
    clicks: done(me.setup.steps.clicks),
    typing: done(me.setup.steps.typing),
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl content-start gap-10">
      {/* Shows where you are; the steps run in order and are not links. */}
      <ol aria-label="Setup steps" className="flex items-center gap-2.5 font-mono text-xs sm:gap-3">
        {STEPS.map(({ id, title }, i) => (
          <li
            key={id}
            aria-current={id === view ? 'step' : undefined}
            className={`flex items-center gap-2.5 sm:gap-3 ${i > 0 ? 'min-w-0 flex-1' : ''}`}
          >
            {i > 0 && (
              <span
                className={`h-px min-w-3 flex-1 transition-colors duration-300 ${finished[STEPS[i - 1].id] ? 'bg-foreground/30' : 'bg-border'}`}
                aria-hidden="true"
              />
            )}
            <span
              className={`flex items-center gap-2 whitespace-nowrap transition-colors duration-150 ${id === view ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              <span className="grid size-3.5 place-items-center" aria-hidden="true">
                {finished[id] ? (
                  <Check className="size-3.5" strokeWidth={2.5} />
                ) : (
                  <span className={`size-1.5 rounded-full ${id === view ? 'bg-primary' : 'border border-input'}`} />
                )}
              </span>
              {title}
              {finished[id] && <span className="sr-only">(complete)</span>}
            </span>
          </li>
        ))}
      </ol>

      <section
        key={view}
        className="grid animate-in gap-7 duration-300 fill-mode-both fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
      >
        {view === 'consent' && <ConsentStep me={me} onMe={onMe} />}
        {view === 'clicks' && <ClickStep me={me} />}
        {view === 'typing' && <TypingStep me={me} onTyping={(typed) => setMidSentence(typed > 0)} />}
        {view === 'done' && <Finished me={me} onFinish={onFinish} />}
      </section>
    </div>
  )
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <h1 className="text-3xl">{title}</h1>
      {children && <p className="max-w-[60ch] text-muted-foreground">{children}</p>}
    </div>
  )
}

/** Made-up key presses for the consent picture: [gap before the press in px, hold from 0 to 1]. */
const PRESSES: [gap: number, hold: number][] = [
  [0, 0.62], [7, 0.4], [5, 0.85], [11, 0.5], [17, 0.3], [6, 0.7],
  [9, 0.45], [16, 0.28], [5, 0.9], [8, 0.55], [4, 0.75], [10, 0.48],
]

/** The idea in one picture: the letters stay on the page, only their timing is kept. */
function RhythmFigure() {
  const row = 'grid gap-x-6 gap-y-1.5 px-5 py-3.5 sm:grid-cols-[7.75rem_1fr] sm:items-center'
  const label = 'font-mono text-xs text-muted-foreground'
  return (
    <figure className="divide-y divide-border rounded-xl border border-border bg-card">
      <figcaption className="sr-only">
        An example: you type “meet at noon”; Cadence keeps only when each key went down and how long it was held.
      </figcaption>
      <div className={row} aria-hidden="true">
        <span className={label}>You type</span>
        <span className="font-mono text-lg tracking-[0.14em]">meet at noon</span>
      </div>
      <div className={row} aria-hidden="true">
        <span className={label}>Cadence keeps</span>
        <span className="flex h-9 items-center">
          {PRESSES.map(([gap, hold], i) => (
            <span
              key={i}
              className="h-9 w-[3px] shrink-0 rounded-[1px] bg-foreground/75"
              style={{ marginLeft: gap, transform: `scaleY(${hold})` }}
            />
          ))}
        </span>
      </div>
    </figure>
  )
}

function ConsentStep({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function agree() {
    setBusy(true)
    setError(null)
    try {
      onMe(await api.request<Me>('POST', '/consent', { agree: true, keep_raw: false }))
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  const term = 'font-medium'
  const detail = 'text-muted-foreground'
  return (
    <>
      <Heading title="What Cadence records">
        Setup takes about three minutes: agree to this, then a short click test and a typing test.
      </Heading>

      <RhythmFigure />

      <dl className="grid border-b border-border *:grid *:gap-x-6 *:gap-y-1 *:border-t *:border-border *:py-3.5 sm:*:grid-cols-[9rem_1fr]">
        <div>
          <dt className={term}>Recorded</dt>
          <dd className={detail}>
            Key timing and which part of the keyboard each key is on. Pointer movement and clicks. Only on Cadence and
            on sites you connect.
          </dd>
        </div>
        <div>
          <dt className={term}>Never recorded</dt>
          <dd className={detail}>What you type, or which keys of your password you press.</dd>
        </div>
        <div>
          <dt className={term}>Kept</dt>
          <dd className={detail}>
            Measurements only. Your profile stays until you delete it. Checks and sign-in evidence are removed after{' '}
            {me.retention_days} days. You can delete everything at any time.
          </dd>
        </div>
      </dl>

      <div className="grid gap-5">
        <p className="max-w-[60ch]">
          By continuing, you agree that Cadence may record your key timing and pointer movement as described, and use
          them to check sign-ins and sensitive actions on sites you connect.
        </p>
        <Button size="lg" disabled={busy} onClick={agree} className="justify-self-start">
          Agree and continue
          <ArrowRight
            aria-hidden="true"
            className="transition-transform duration-150 group-hover/button:translate-x-0.5 motion-reduce:transition-none"
          />
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </>
  )
}

function ClickStep({ me }: { me: Me }) {
  const { progress, last } = usePassive()
  const step = me.setup.steps.clicks
  const filled = useHighWater(fraction(step, progress.strokes, STROKES_PER_WINDOW))
  const left = Math.ceil((1 - filled) * step.needed * STROKES_PER_WINDOW)
  const note = notCounted(last, 'pointer')

  return (
    <>
      <Heading title="Click each circle">
        Aim and click the way you normally would. It takes about 40 seconds.
      </Heading>
      <TargetTest progress={filled} status={left > 0 ? `${left} to go` : 'Saving…'} />
      {note && <Note>{note}</Note>}
    </>
  )
}

function TypingStep({ me, onTyping }: { me: Me; onTyping: (typed: number) => void }) {
  const { progress, last } = usePassive()
  const step = me.setup.steps.typing
  const complete = done(step)
  const filled = useHighWater(fraction(step, progress.keys, KEYS_PER_WINDOW))
  const sentences = Math.ceil(((1 - filled) * step.needed * KEYS_PER_WINDOW) / SENTENCE_KEYS)
  // Where this visit began, so a sample saved mid-sentence does not swap the sentence.
  const [start] = useState(step.done)
  const note = notCounted(last, 'keys')

  return (
    <>
      <Heading title="Type each sentence">
        Type at your normal pace and leave mistakes if you like. The next sentence appears by itself.
      </Heading>
      <div className="grid gap-3">
        <SentenceTest start={start} onTyping={onTyping} autoFocus />
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Progress value={filled} label="Typing test progress" />
          </div>
          <span className="font-mono text-xs text-muted-foreground" aria-live="polite">
            {complete
              ? 'finish this sentence'
              : sentences > 1
                ? `about ${sentences} sentences to go`
                : sentences === 1
                  ? 'last sentence'
                  : 'Saving…'}
          </span>
        </div>
      </div>
      {!complete && note && <Note>{note}</Note>}
    </>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {children}
    </p>
  )
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** The closing screen: setup is saved, and the dashboard is one click away. */
function Finished({ me, onFinish }: { me: Me; onFinish: () => void }) {
  return (
    <>
      <Heading title="You’re set up">
        Cadence now has a profile of how you type and click. Connect a site and your sign-ins there are checked
        against it.
      </Heading>
      <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
        {count(me.passive.keys.windows, 'typing sample')} · {count(me.passive.pointer.windows, 'click sample')} saved
      </p>
      <Button size="lg" onClick={onFinish} className="justify-self-start">
        Go to dashboard
        <ArrowRight
          aria-hidden="true"
          className="transition-transform duration-150 group-hover/button:translate-x-0.5 motion-reduce:transition-none"
        />
      </Button>
    </>
  )
}
