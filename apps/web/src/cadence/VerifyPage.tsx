import { recordActivity, type ActivityRecorder } from '@cadence/sdk'
import { ArrowLeft, CircleDashed, Hourglass, KeyRound, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { Wordmark } from '@/components/Wordmark'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, explain } from '@/lib/api'
import { ACTION_LABEL, MODALITY_LABEL, type Modality, type PassiveDecision, type StepUpInfo, type TestOption } from '@/lib/product'

import { SENTENCES, SentenceTest, TargetTest } from './tests'

const ICON = 'size-5 shrink-0'

function why(info: StepUpInfo): { icon: ReactNode; title: string; text: string } {
  if (info.outcome === 'INCONSISTENT')
    return {
      icon: <ShieldAlert className={`${ICON} text-destructive`} aria-hidden="true" />,
      title: 'That sign-in did not look like you',
      text: 'The typing or clicking was unlike your profile. It happens with a new keyboard, an injury, or someone else at your account. Confirm it was you to continue.',
    }
  if (info.outcome === 'UNCERTAIN')
    return {
      icon: <Hourglass className={`${ICON} text-uncertain`} aria-hidden="true" />,
      title: 'Cadence was not sure',
      text: 'The sign-in sat between “clearly you” and “clearly not”. One short test usually settles it.',
    }
  return {
    icon: <CircleDashed className={ICON} aria-hidden="true" />,
    title: 'Not enough to go on',
    text:
      info.reason === 'not_enrolled'
        ? 'Your Cadence setup is not finished, so there is no profile to compare with yet.'
        : 'There was too little typing or clicking to compare (autofill, for example). This is not a mismatch.',
  }
}

function recommendationText(option: TestOption, other: TestOption | undefined): string {
  const share = Math.round(option.own_samples_clear * 100)
  const base = `${share}% of your own ${option.modality === 'keys' ? 'typing' : 'click'} samples clear the bar on their own`
  if (!other) return `${base}, so this is the quickest way to show it is you.`
  const otherShare = Math.round(other.own_samples_clear * 100)
  const otherName = other.modality === 'keys' ? 'typing' : 'clicking'
  if (Math.abs(share - otherShare) < 5)
    return `${base}, like your ${otherName}, but they sit further above the pass mark, so this test is less likely to be a close call.`
  return `${base}, against ${otherShare}% for ${otherName}. For you, this test is the more reliable one.`
}

/**
 * Verifying another way, for a check a partner site could not settle. Cadence picks the short
 * test this person's own profile is most likely to pass; the demo authenticator is always there.
 */
export function VerifyPage({ checkId }: { checkId: string }) {
  const params = new URLSearchParams(window.location.search)
  const returnTo = params.get('return_to')
  const [info, setInfo] = useState<StepUpInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Modality | 'code' | null>(null)
  const [result, setResult] = useState<PassiveDecision | null>(null)

  const load = useCallback(async () => {
    try {
      const query = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''
      const loaded = await api.request<StepUpInfo>('GET', `/stepup/${checkId}${query}`)
      setInfo(loaded)
      setMode((m) => m ?? loaded.recommendation.recommended ?? 'code')
    } catch (e) {
      setError(explain(e, { check_unknown: 'This verification link is not valid. Start again from the site you were signing in to.' }))
    }
  }, [checkId, returnTo])

  useEffect(() => {
    void load()
  }, [load])

  const options = info?.recommendation.options ?? []
  const recommended = options.find((o) => o.modality === info?.recommendation.recommended)
  const other = options.find((o) => o.modality !== info?.recommendation.recommended)

  return (
    <div className="mx-auto grid min-h-svh w-full max-w-3xl content-start gap-8 px-5 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <Wordmark />
        <span className="font-mono text-sm text-muted-foreground">Verify it’s you</span>
      </header>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!info && !error && <p className="text-muted-foreground">Loading…</p>}

      {info && (
        <main className="grid gap-6">
          <div className="grid gap-2">
            <p className="font-mono text-sm text-muted-foreground">
              {info.site} · {ACTION_LABEL[info.action] ?? info.action} · {info.username}
            </p>
            <h1 className="text-4xl font-extrabold">Confirm it’s you to continue to {info.site}.</h1>
          </div>

          {info.resolved ? (
            <Done info={info} returnTo={info.return_to} />
          ) : info.expired ? (
            <p className="rounded-lg border border-rule bg-card p-5">This check has expired. Go back to {info.site} and try again.</p>
          ) : (
            <>
              <Reason info={info} />
              {recommended && (
                <section className="grid gap-4 rounded-xl border border-primary/40 bg-card p-5 sm:p-7">
                  <div className="flex items-start gap-3">
                    <Sparkles className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
                    <div className="grid gap-1">
                      <h2 className="text-xl font-bold">
                        Recommended for you: {recommended.modality === 'keys' ? 'type one sentence' : 'click 14 circles'}
                      </h2>
                      <p className="text-muted-foreground">{recommendationText(recommended, other)}</p>
                    </div>
                  </div>
                  <ModeSwitch mode={mode} onMode={setMode} options={options} />
                  {(mode === 'keys' || mode === 'pointer') && info.tests_left > 0 && (
                    <QuickTest
                      key={`${mode}-${info.tests_left}`}
                      modality={mode}
                      checkId={checkId}
                      onResult={(decision) => (setResult(decision), void load())}
                    />
                  )}
                  {(mode === 'keys' || mode === 'pointer') && info.tests_left === 0 && (
                    <p>No tests left for this check. Use the authenticator instead.</p>
                  )}
                  {result && !info.resolved && <TestResult decision={result} testsLeft={info.tests_left} />}
                </section>
              )}
              {(mode === 'code' || !recommended) && <StepUpCode checkId={checkId} onDone={load} />}
              {recommended && mode !== 'code' && (
                <Button variant="link" onClick={() => setMode('code')} className="h-auto justify-self-start p-0 text-base">
                  <KeyRound aria-hidden="true" />
                  Use the authenticator instead
                </Button>
              )}
            </>
          )}
        </main>
      )}
    </div>
  )
}

function Reason({ info }: { info: StepUpInfo }) {
  const { icon, title, text } = why(info)
  return (
    <div className="grid gap-1.5 rounded-lg border border-rule bg-muted/50 p-4" role="status">
      <p className="flex items-center gap-2 font-heading text-lg font-bold">
        {icon}
        {title}
      </p>
      <p className="text-foreground/85">{text}</p>
    </div>
  )
}

function ModeSwitch({ mode, onMode, options }: { mode: Modality | 'code' | null; onMode: (m: Modality) => void; options: TestOption[] }) {
  if (options.length < 2) return null
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a test">
      {options.map((o) => (
        <Button
          key={o.modality}
          variant={mode === o.modality ? 'secondary' : 'ghost'}
          aria-pressed={mode === o.modality}
          onClick={() => onMode(o.modality)}
          className="h-10 px-4 text-base"
        >
          {o.modality === 'keys' ? 'Typing test' : 'Click test'}
        </Button>
      ))}
    </div>
  )
}

function QuickTest({ modality, checkId, onResult }: { modality: Modality; checkId: string; onResult: (d: PassiveDecision) => void }) {
  const area = useRef<HTMLDivElement>(null)
  const recorder = useRef<ActivityRecorder | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentence = useRef(Math.floor(Math.random() * SENTENCES.length))

  useEffect(() => {
    if (!area.current) return
    recorder.current = recordActivity({ root: area.current })
    return () => recorder.current?.stop()
  }, [])

  async function submit() {
    if (!recorder.current) return
    setBusy(true)
    setError(null)
    try {
      const out = await api.request<{ decision: PassiveDecision }>('POST', `/stepup/${checkId}/test`, recorder.current.snapshot())
      onResult(out.decision)
    } catch (e) {
      setError(explain(e, { no_tests_left: 'No tests left for this check. Use the authenticator instead.' }))
      setBusy(false)
    }
  }

  return (
    <div ref={area} className="grid gap-4">
      {modality === 'keys' ? (
        <SentenceTest sentences={[SENTENCES[sentence.current]]} onSentence={() => setReady(true)} autoFocus />
      ) : (
        <TargetTest total={14} onDone={() => setReady(true)} />
      )}
      <Button size="lg" onClick={submit} disabled={!ready || busy} className="h-11 justify-self-start px-5 text-base">
        {busy ? 'Checking…' : `Check my ${MODALITY_LABEL[modality].toLowerCase()}`}
      </Button>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function TestResult({ decision, testsLeft }: { decision: PassiveDecision; testsLeft: number }) {
  const label =
    decision.outcome === 'INCONSISTENT'
      ? 'That did not match your profile either.'
      : decision.outcome === 'UNCERTAIN'
        ? 'Still not sure.'
        : 'There was not enough in that test to compare.'
  return (
    <p className="rounded-lg border border-rule bg-muted/50 p-4" role="status">
      {label} {testsLeft > 0 ? 'You can try once more, or use the authenticator.' : 'Use the authenticator to continue.'}
    </p>
  )
}

function StepUpCode({ checkId, onDone }: { checkId: string; onDone: () => void }) {
  const [issued, setIssued] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      setIssued((await api.request<{ demo_code: string }>('POST', `/stepup/${checkId}/start`)).demo_code)
      setCode('')
    } catch (e) {
      setError(explain(e))
    }
    setBusy(false)
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.request('POST', `/stepup/${checkId}/verify`, { code })
      onDone()
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  return (
    <section className="grid gap-4 rounded-lg border border-dashed border-input bg-muted/60 p-5">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="grid gap-1">
          <p className="font-medium">Demo authenticator</p>
          <p className="text-sm text-muted-foreground">
            Simulated for the hackathon demo. This is not production authentication: a real deployment would ask for the
            passkey registered to your Cadence account here.
          </p>
        </div>
      </div>
      {issued ? (
        <form onSubmit={verify} className="grid gap-3">
          <p className="rounded-md border border-rule bg-card px-4 py-3">
            <span className="block text-sm text-muted-foreground">Your one-time code (demo only)</span>
            <span className="font-mono text-3xl tracking-[0.3em]">{issued}</span>
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="stepup-code">Enter the code</Label>
            <Input
              id="stepup-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="h-11 font-mono text-lg tracking-[0.3em]"
            />
          </div>
          <Button type="submit" size="lg" disabled={busy || code.length !== 6} className="h-11 justify-self-start px-5 text-base">
            {busy ? 'Checking…' : 'Verify'}
          </Button>
        </form>
      ) : (
        <Button size="lg" onClick={start} disabled={busy} className="h-11 justify-self-start px-5 text-base">
          {busy ? 'One moment…' : 'Get a code'}
        </Button>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}

function Done({ info, returnTo }: { info: StepUpInfo; returnTo: string | null }) {
  const how =
    info.resolved_by === 'test'
      ? 'Your test matched your profile.'
      : info.resolved_by === 'fallback'
        ? 'Verified with the demo authenticator.'
        : 'Your sign-in already matched your profile.'
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5 rounded-lg border border-consistent/50 bg-consistent/8 p-4" role="status">
        <p className="flex items-center gap-2 font-heading text-lg font-bold">
          <ShieldCheck className={`${ICON} text-consistent`} aria-hidden="true" />
          Confirmed
        </p>
        <p className="text-foreground/85">
          {how} This sign-in has been added to your profile, so future checks know you a little better.
        </p>
      </div>
      {returnTo ? (
        <Button size="lg" onClick={() => window.location.assign(returnTo)} className="h-11 justify-self-start px-5 text-base">
          <ArrowLeft aria-hidden="true" />
          Back to {info.site}
        </Button>
      ) : (
        <p className="text-muted-foreground">You can close this tab and return to {info.site}.</p>
      )}
    </div>
  )
}
