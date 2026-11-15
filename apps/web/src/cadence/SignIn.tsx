import { recordActivity, type ActivityCounts, type ActivityRecorder } from '@cadence/sdk'
import { ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, explain } from '@/lib/api'
import type { Me } from '@/lib/product'

const ACCOUNT_ERRORS = {
  username_taken: 'That username already has a Cadence account. Sign in instead.',
  invalid_username: 'Use 3 to 24 letters or numbers for the username.',
}

/** One key press as the readout draws it: time since the previous press, and how long it was held. */
interface Stroke {
  id: number
  gap: number
  /** Null while the key is still down. */
  hold: number | null
}

const MAX_STROKES = 56
const NOT_TYPING = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Enter'])
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Follows key presses inside `root` for the on-screen readout only. It keeps hold time and
 * the gap between presses (the two things the rhythm model scores), never which key it was.
 */
function useStrokes(root: RefObject<HTMLElement | null>) {
  const [strokes, setStrokes] = useState<Stroke[]>([])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const abort = new AbortController()
    const listen = { signal: abort.signal, passive: true, capture: true }
    const held = new Map<string, { id: number; at: number }>()
    let last: number | null = null
    let next = 0

    el.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat || NOT_TYPING.has(e.key) || held.has(e.code)) return
        const id = next++
        const gap = last === null ? 0 : e.timeStamp - last
        last = e.timeStamp
        held.set(e.code, { id, at: e.timeStamp })
        setStrokes((s) => [...s.slice(1 - MAX_STROKES), { id, gap, hold: null }])
      },
      listen,
    )
    el.addEventListener(
      'keyup',
      (e) => {
        const press = held.get(e.code)
        if (!press) return
        held.delete(e.code)
        const hold = e.timeStamp - press.at
        setStrokes((s) => s.map((k) => (k.id === press.id ? { ...k, hold } : k)))
      },
      listen,
    )
    window.addEventListener('blur', () => held.clear(), { signal: abort.signal })
    return () => abort.abort()
  }, [root])

  return [strokes, () => setStrokes([])] as const
}

/**
 * The live readout on the sign-in form: one bar per key press. Height is how long the key was
 * held, spacing is the time since the previous press. Decorative; the counts beside it are text.
 */
function RhythmReadout({ strokes, counts }: { strokes: Stroke[]; counts: ActivityCounts }) {
  const active = strokes.length > 0
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 font-mono text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="relative flex size-1.5" aria-hidden="true">
            {active && (
              <span className="absolute inset-0 animate-beckon rounded-full bg-primary motion-reduce:animate-none" />
            )}
            <span className={`relative size-1.5 rounded-full ${active ? 'bg-primary' : 'bg-input'}`} />
          </span>
          Rhythm signal
        </span>
        <span className="tabular-nums">
          {counts.keys === 0 && counts.clicks === 0
            ? 'timing only'
            : `${counts.keys} ${counts.keys === 1 ? 'key' : 'keys'} · ${counts.clicks} ${counts.clicks === 1 ? 'click' : 'clicks'}`}
        </span>
      </div>

      <div className="relative h-14 overflow-hidden rounded-lg border border-border bg-background" aria-hidden="true">
        <div className="absolute inset-x-3 top-1/2 border-t border-dashed border-input/70" />
        <p
          className={`absolute inset-0 grid place-items-center bg-background/80 text-xs text-muted-foreground transition-opacity duration-200 motion-reduce:transition-none ${active ? 'opacity-0' : 'opacity-100'}`}
        >
          Start typing to see your rhythm
        </p>
        <div className="absolute inset-y-0 right-3 left-0 flex items-center justify-end [mask-image:linear-gradient(to_right,transparent,black_28%)]">
          {strokes.map((k, i) => (
            <span
              key={k.id}
              className={`h-9 w-[3px] shrink-0 rounded-[1px] transition-transform duration-150 ease-out motion-reduce:transition-none ${i === strokes.length - 1 ? 'bg-primary' : 'bg-foreground/75'}`}
              style={{
                marginLeft: i === 0 ? 0 : clamp(k.gap / 40, 2, 18),
                transform: `scaleY(${k.hold === null ? 0.14 : clamp((k.hold - 30) / 170, 0.18, 1)})`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface SignInProps {
  onSignedIn: (me: Me) => void
  /** Shown under the form title, e.g. which site this sign-in connects. */
  note?: ReactNode
  initialMode?: 'login' | 'register'
}

/**
 * Cadence account sign-in. The typing on this form (zones and timing; the password field is
 * timing only) is sent with the sign-in: during setup it counts as one of the separate
 * sign-ins the profile needs. The readout shows that timing as it is recorded.
 */
export function SignInForm({ onSignedIn, note, initialMode = 'login' }: SignInProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState<ActivityCounts>({ keys: 0, clicks: 0 })
  const form = useRef<HTMLFormElement>(null)
  const recorder = useRef<ActivityRecorder | null>(null)
  const [strokes, clearStrokes] = useStrokes(form)
  const creating = mode === 'register'

  useEffect(() => {
    if (!form.current) return
    recorder.current = recordActivity({ root: form.current, onChange: setCounts })
    return () => recorder.current?.stop()
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const activity = recorder.current?.snapshot() ?? null
    try {
      onSignedIn(await api.request<Me>('POST', `/auth/${mode}`, { username, password, activity }))
    } catch (e) {
      recorder.current?.reset()
      clearStrokes()
      setError(explain(e, ACCOUNT_ERRORS))
      setBusy(false)
    }
  }

  return (
    <form
      ref={form}
      onSubmit={submit}
      className="grid gap-5 rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_rgb(13_16_23/0.04),0_28px_56px_-28px_rgb(47_75_255/0.22)] sm:p-7"
    >
      <div className="grid gap-1.5">
        <h2 className="text-lg">{creating ? 'Create your account' : 'Sign in'}</h2>
        {note}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="account-username">Username</Label>
        <Input
          id="account-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={24}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="account-password">Password</Label>
        <Input
          id="account-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={creating ? 'new-password' : 'current-password'}
          required
          minLength={8}
          maxLength={200}
          aria-describedby={creating ? 'password-hint' : undefined}
        />
        {creating && (
          <p id="password-hint" className="text-sm text-muted-foreground">
            At least 8 characters.
          </p>
        )}
      </div>

      <RhythmReadout strokes={strokes} counts={counts} />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? 'One moment' : creating ? 'Create account' : 'Sign in'}
        {!busy && (
          <ArrowRight
            className="transition-transform duration-150 group-hover/button:translate-x-0.5 motion-reduce:transition-none"
            aria-hidden="true"
          />
        )}
      </Button>

      <p className="text-sm text-muted-foreground">
        {creating ? 'Already have an account? ' : 'New to Cadence? '}
        <button
          type="button"
          onClick={() => (setMode(creating ? 'login' : 'register'), setError(null))}
          className="cursor-pointer rounded font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {creating ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </form>
  )
}

/** What Cadence reads, each with a small drawing of the measurement. */
const SIGNALS = [
  {
    name: 'Hold',
    detail: 'How long each key stays down.',
    glyph: (
      <>
        {[9, 15, 6, 12, 18].map((h, i) => (
          <rect key={i} x={4 + i * 9} y={12 - h / 2} width="3" height={h} rx="1" className={i === 4 ? 'fill-primary' : 'fill-foreground'} />
        ))}
      </>
    ),
  },
  {
    name: 'Gap',
    detail: 'The time from one key to the next.',
    glyph: (
      <>
        {[4, 9, 21, 27, 40].map((x, i) => (
          <rect key={i} x={x} y="6" width="3" height="12" rx="1" className={i === 4 ? 'fill-primary' : 'fill-foreground'} />
        ))}
      </>
    ),
  },
  {
    name: 'Path',
    detail: 'How your pointer travels to what you click.',
    glyph: (
      <>
        <path d="M3 19c7 0 7-14 14-14s5 11 11 11 4-5 8-5" className="fill-none stroke-foreground" strokeWidth="2" strokeLinecap="round" />
        <circle cx="41" cy="11" r="4" className="fill-primary" />
      </>
    ),
  },
]

const RISE = 'animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 motion-reduce:animate-none'

/** The signed-out Cadence home page. */
export function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  return (
    <div className="relative flex flex-1 flex-col">
      <div
        className="pointer-events-none absolute inset-x-0 -top-6 h-[34rem] bg-[radial-gradient(circle,var(--input)_1px,transparent_1.5px)] [background-size:22px_22px] opacity-60 [mask-image:radial-gradient(ellipse_60%_55%_at_30%_45%,black,transparent)]"
        aria-hidden="true"
      />

      <div className="relative grid flex-1 content-center items-center gap-12 lg:grid-cols-[1fr_minmax(0,25rem)] lg:gap-16">
        <div className="grid gap-8">
          <div className="grid gap-5">
            <p className={`flex items-center gap-2 font-mono text-xs text-muted-foreground ${RISE}`}>
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              Behavioral second factor
            </p>
            <h1 className={`text-4xl tracking-[-0.035em] sm:text-5xl lg:text-[3.25rem] lg:leading-[1.05] ${RISE} delay-75`}>
              Your typing is the second factor.
            </h1>
            <p className={`max-w-md text-lg text-muted-foreground ${RISE} delay-150`}>
              Cadence learns how you type and click. When a <span className="whitespace-nowrap">sign-in</span> looks like
              you, there is no code to enter.
            </p>
          </div>

          {/* Below the two-column layout the form comes first, so the list waits for wide screens. */}
          <dl className={`hidden max-w-md border-b border-border lg:grid ${RISE} delay-200`}>
            {SIGNALS.map((signal) => (
              <div key={signal.name} className="grid grid-cols-[3.5rem_3.5rem_1fr] items-center gap-x-3 border-t border-border py-3">
                <svg viewBox="0 0 48 24" className="h-6 w-12" aria-hidden="true">
                  {signal.glyph}
                </svg>
                <dt className="font-medium">{signal.name}</dt>
                <dd className="text-sm text-muted-foreground">{signal.detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className={`${RISE} delay-150`}>
          <SignInForm onSignedIn={onSignedIn} />
        </div>
      </div>
    </div>
  )
}
