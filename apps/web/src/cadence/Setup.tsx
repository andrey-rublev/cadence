import { Check, Keyboard, LogIn, MousePointerClick, ShieldCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api, explain } from '@/lib/api'
import type { Me, SetupStep } from '@/lib/product'
import { usePassive } from '@/product/PassiveCapture'

import { SentenceTest, TargetTest } from './tests'

type StepId = 'consent' | 'clicks' | 'typing' | 'sign_ins'

const STEPS: { id: StepId; title: string; icon: ReactNode; time: string }[] = [
  { id: 'consent', title: 'Agree to recording', icon: <ShieldCheck aria-hidden="true" />, time: '20 s' },
  { id: 'clicks', title: 'Click test', icon: <MousePointerClick aria-hidden="true" />, time: 'about 40 s' },
  { id: 'typing', title: 'Typing test', icon: <Keyboard aria-hidden="true" />, time: 'about 2 min' },
  { id: 'sign_ins', title: 'Sign in again', icon: <LogIn aria-hidden="true" />, time: 'two more times' },
]

const done = (s: SetupStep) => s.done >= s.needed

function currentStep(me: Me): StepId {
  if (!me.consent) return 'consent'
  if (!done(me.setup.steps.clicks)) return 'clicks'
  if (!done(me.setup.steps.typing)) return 'typing'
  return 'sign_ins'
}

function stepState(id: StepId, me: Me): string {
  if (id === 'consent') return me.consent ? 'Done' : ''
  const step = me.setup.steps[id]
  return done(step) ? 'Done' : `${Math.min(step.done, step.needed)} of ${step.needed}`
}

/** Three short steps on the Cadence site collect what partner sites will be checked against. */
export function Setup({ me, onMe, onSignOut }: { me: Me; onMe: (me: Me) => void; onSignOut: () => void }) {
  const active = currentStep(me)
  const [chosen, setChosen] = useState<StepId | null>(null)
  const step = chosen ?? active

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <p className="font-mono text-sm text-muted-foreground">Set up Cadence · {me.username}</p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">Teach Cadence how you type and click.</h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          About three minutes here, then two quick sign-ins later. After that, sites that use Cadence check you from the
          sign-in you were doing anyway.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
        <ol className="grid content-start gap-2" aria-label="Setup steps">
          {STEPS.map(({ id, title, icon, time }, i) => {
            const state = stepState(id, me)
            const finished = state === 'Done'
            const current = id === step
            const reachable = finished || id === active
            return (
              <li key={id}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => setChosen(id === active ? null : id)}
                  aria-current={current ? 'step' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                    current ? 'border-primary bg-card shadow-sm' : 'border-rule bg-card/50 hover:bg-card'
                  }`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4 ${
                      finished ? 'bg-consistent text-white' : current ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}
                  >
                    {finished ? <Check aria-hidden="true" /> : icon}
                  </span>
                  <span className="grid">
                    <span className="font-medium">
                      <span className="sr-only">Step {i + 1}: </span>
                      {title}
                    </span>
                    <span className="text-sm text-muted-foreground">{state || time}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        <section className="grid content-start gap-5 rounded-xl border border-rule bg-card p-5 sm:p-7">
          {step === 'consent' && <ConsentStep onMe={onMe} />}
          {step === 'clicks' && <ClickStep me={me} />}
          {step === 'typing' && <TypingStep me={me} />}
          {step === 'sign_ins' && <SignInStep me={me} onSignOut={onSignOut} />}
        </section>
      </div>
    </div>
  )
}

function ConsentStep({ onMe }: { onMe: (me: Me) => void }) {
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    try {
      onMe(await api.request<Me>('POST', '/consent', { agree: true, keep_raw: false }))
    } catch (e) {
      setError(explain(e))
    }
  }

  return (
    <>
      <h2 className="text-2xl font-bold">What Cadence records</h2>
      <ul className="grid gap-2 text-base">
        <li>
          <span className="font-medium">Recorded:</span> when each key goes down and up and which part of the keyboard
          it is on; how the pointer moves and clicks. Only on Cadence pages and on sites you connect.
        </li>
        <li>
          <span className="font-medium">Never recorded:</span> what you type, which keys of your password you press
          (only their timing), or anything outside those pages.
        </li>
        <li>
          <span className="font-medium">Kept:</span> measurements such as hold times and how straight a path was, for 30
          days at most. You can delete everything at any time.
        </li>
      </ul>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-rule p-4">
        <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-1" />
        <span>
          I agree that Cadence may record my key timing and pointer movement as described, and use them to check
          sign-ins and sensitive actions on sites I connect.
        </span>
      </label>
      <Button size="lg" disabled={!agree} onClick={save} className="h-11 justify-self-start px-5 text-base">
        Agree and continue
      </Button>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </>
  )
}

function ServerProgress({ label, step }: { label: string; step: SetupStep }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {label}: <span className="font-mono text-foreground">{Math.min(step.done, step.needed)}</span> of {step.needed}{' '}
      saved{done(step) ? '. This step is done.' : '.'}
    </p>
  )
}

function ClickStep({ me }: { me: Me }) {
  const { last } = usePassive()
  const [round, setRound] = useState(0)
  const [finished, setFinished] = useState(false)
  const step = me.setup.steps.clicks
  const remaining = Math.max(1, step.needed - step.done)
  // Fixed when each round starts: samples saved mid-round must not shorten the round.
  const [total, setTotal] = useState(() => 12 * remaining + 2)
  return (
    <>
      <div className="grid gap-1">
        <h2 className="text-2xl font-bold">Click test</h2>
        <p className="text-muted-foreground">
          Circles appear one at a time. Click each one the way you normally would. Every twelve clicks become one sample.
        </p>
      </div>
      <TargetTest key={round} total={total} onDone={() => setFinished(true)} />
      <ServerProgress label="Click samples" step={step} />
      {last?.purpose === 'rejected' && last.modality === 'pointer' && (
        <p className="text-sm text-muted-foreground">One stretch had too little movement to count; a few more clicks will cover it.</p>
      )}
      {finished && !done(step) && (
        <Button
          variant="outline"
          onClick={() => (setTotal(12 * remaining + 2), setRound((r) => r + 1), setFinished(false))}
          className="h-11 justify-self-start px-5 text-base"
        >
          A few more circles
        </Button>
      )}
    </>
  )
}

function TypingStep({ me }: { me: Me }) {
  const { progress } = usePassive()
  const step = me.setup.steps.typing
  return (
    <>
      <div className="grid gap-1">
        <h2 className="text-2xl font-bold">Typing test</h2>
        <p className="text-muted-foreground">
          Copy each sentence. About fifty keys make one sample; {step.needed} samples finish this step.
        </p>
      </div>
      <SentenceTest start={step.done} autoFocus />
      <div className="grid gap-1">
        <ServerProgress label="Typing samples" step={step} />
        <p className="text-sm text-muted-foreground">
          Keys towards the next sample: <span className="font-mono">{progress.keys} / 50</span>
        </p>
      </div>
    </>
  )
}

function SignInStep({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const step = me.setup.steps.sign_ins
  const left = Math.max(0, step.needed - step.done)
  return (
    <>
      <div className="grid gap-1">
        <h2 className="text-2xl font-bold">Sign in again, {left === 1 ? 'once more' : `${left} more times`}</h2>
        <p className="max-w-prose text-muted-foreground">
          One sitting is not enough: people type a little differently from one sign-in to the next, and that is what
          partner sites will see. Sign out, then sign back in. Type your username and password yourself rather than
          using autofill, because the typing on the sign-in form is what counts. Later today or tomorrow is even better
          than right away.
        </p>
      </div>
      <ServerProgress label="Sign-ins with typing" step={step} />
      <Button size="lg" onClick={onSignOut} className="h-11 justify-self-start px-5 text-base">
        <LogIn aria-hidden="true" />
        Sign out and sign back in
      </Button>
    </>
  )
}
