import type { ActivityRecorder } from '@cadence/sdk'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'

import { SignInFields, type SignInStep } from '@/components/SignInFields'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, evidenceToken, explain, recordActivity, type Practice } from '@/lib/api'

const NOT_SAVED: Record<string, string> = {
  did_not_match: 'That didn’t match your typing profile. Try again, typing the way you usually do.',
  too_little_typing: 'Not saved. Cadence saw too little typing. Type your email and password by hand, without autofill or paste.',
}

/**
 * Right after connecting: the person types their Northwind email and password a few times, on
 * the same two-screen form as the real sign-in. Northwind checks the password; Cadence gets only
 * the timing, and keeps it as samples of how this person signs in here.
 */
export function PracticeSignIns({ pageRecorder }: { pageRecorder: RefObject<ActivityRecorder | null> }) {
  const [status, setStatus] = useState<Practice | null>(null)
  const [step, setStep] = useState<SignInStep>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState<{ saved: boolean; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const recorder = useRef<ActivityRecorder | null>(null)

  useEffect(() => {
    api<Practice>('GET', '/cadence/practice').then(setStatus, (e) => setError(explain(e)))
  }, [])

  // The form only exists while practice is open, so the recorder follows it.
  const attach = useCallback((form: HTMLFormElement | null) => {
    recorder.current?.stop()
    recorder.current = form ? recordActivity({ root: form }) : null
  }, [])

  function startOver() {
    setStep('email')
    setEmail('')
    setPassword('')
    recorder.current?.reset()
    // This typing included the password's timing; it is not evidence for a later export.
    pageRecorder.current?.reset()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (step === 'email') {
      setStep('password')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const evidence = await evidenceToken(recorder.current)
      const out = await api<Practice>('POST', '/cadence/practice', { email, password, evidence })
      setStatus(out)
      setNote(
        out.accepted
          ? { saved: true, text: 'Saved.' }
          : { saved: false, text: NOT_SAVED[out.reason ?? ''] ?? 'That one wasn’t saved. Try again.' },
      )
    } catch (e) {
      setNote(null)
      setError(explain(e))
    } finally {
      startOver()
      setBusy(false)
    }
  }

  if (!status)
    return error ? (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <div aria-busy className="h-5 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
    )

  if (status.complete)
    return (
      <p className="flex items-center gap-2 border-t border-border pt-5">
        <CheckCircle2 className="size-4 shrink-0 text-good" aria-hidden="true" />
        Cadence has learned your Northwind sign-in.
      </p>
    )

  if (!status.open)
    return (
      <p className="border-t border-border pt-5 text-sm text-muted-foreground">
        Practice has closed for this connection. To start over, disconnect Northwind in Cadence, then turn Cadence off
        and on here.
      </p>
    )

  return (
    <div className="grid gap-4 border-t border-border pt-5">
      <div className="grid gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-base">Teach Cadence your sign-in</h3>
          <span className="text-sm text-muted-foreground tabular-nums" role="status" aria-live="polite">
            {status.samples} of {status.needed}
            {status.attempts_left <= 3 && `, ${status.attempts_left} ${status.attempts_left === 1 ? 'try' : 'tries'} left`}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in below {status.needed} times, typing normally and without autofill. Cadence only receives the timing.
        </p>
      </div>

      <div className="flex max-w-sm gap-1.5" aria-hidden="true">
        {Array.from({ length: status.needed }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < status.samples ? 'bg-good' : 'bg-foreground/10'}`} />
        ))}
      </div>

      <form ref={attach} onSubmit={submit} className="grid max-w-sm grid-cols-1 gap-4">
        <SignInFields
          id="practice"
          step={step}
          email={email}
          password={password}
          onEmail={setEmail}
          onPassword={setPassword}
          onChangeEmail={() => (setStep('email'), setPassword(''), recorder.current?.reset())}
          busy={busy}
        />
        <Button type="submit" size="lg" disabled={busy} className="justify-self-start">
          {busy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {step === 'email' ? 'Continue' : 'Save sign-in'}
        </Button>
      </form>

      {note && (
        <p className={`text-sm ${note.saved ? 'text-good' : 'text-destructive'}`} role="status">
          {note.text}
        </p>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
