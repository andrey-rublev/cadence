import type { ActivityRecorder } from '@cadence/sdk'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'

import { SignInFields, type SignInStep } from '@/components/SignInFields'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, evidenceToken, explain, recordActivity, type Practice } from '@/lib/api'

const NOT_SAVED: Record<string, string> = {
  did_not_match: 'Not saved: that typing did not look like your Cadence typing test. Type it the way you usually do.',
  not_sign_in_length: 'Not saved: Cadence needs 12 to 45 keys in all, and that was outside it.',
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
          ? { saved: true, text: `Saved: ${Math.min(out.samples, out.needed)} of ${out.needed}.` }
          : { saved: false, text: NOT_SAVED[out.reason ?? ''] ?? `Not saved: Cadence could not check it (${out.reason}).` },
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
      <p className="text-sm text-muted-foreground">Checking with Cadence…</p>
    )

  if (status.complete)
    return (
      <div className="grid gap-1 rounded-lg border border-good/40 bg-good/8 p-4">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-5 text-good" aria-hidden="true" />
          Cadence has {status.samples} of your Northwind sign-ins.
        </p>
        <p className="text-sm text-muted-foreground">
          {status.compared
            ? 'New sign-ins here are compared with these as well as with your Cadence profile.'
            : 'With these, Cadence has enough to check your sign-ins here against your profile. Comparing new sign-ins with these samples directly stays off until it is shown to help.'}
        </p>
      </div>
    )

  if (!status.open)
    return (
      <p className="rounded-lg border border-border p-4 text-sm">
        Cadence is no longer taking practice sign-ins for this connection ({status.samples} of {status.needed} saved). To
        start over, disconnect Northwind on your Cadence home page, then turn Cadence off and back on here.
      </p>
    )

  return (
    <div className="grid gap-4 rounded-lg border border-marigold/60 bg-marigold/8 p-5">
      <div className="grid gap-1">
        <h3 className="text-lg font-semibold">Teach Cadence your Northwind sign-in</h3>
        <p className="text-sm text-muted-foreground">
          Type your Northwind email and password {status.needed} times, the way you normally sign in, without autofill.
          Northwind checks the password; Cadence only receives the timing.
        </p>
      </div>

      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <span className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: status.needed }, (_, i) => (
            <span
              key={i}
              className={`size-2.5 rounded-full ${i < status.samples ? 'bg-good' : 'border border-foreground/30 bg-card'}`}
            />
          ))}
        </span>
        <span className="text-sm">
          {status.samples} of {status.needed} saved
          {status.attempts_left <= 3 && ` · ${status.attempts_left} tries left`}
        </span>
      </div>

      <form ref={attach} onSubmit={submit} className="grid max-w-sm gap-4">
        <SignInFields
          id="practice"
          step={step}
          email={email}
          password={password}
          onEmail={setEmail}
          onPassword={setPassword}
          onChangeEmail={() => (setStep('email'), setPassword(''), recorder.current?.reset())}
        />
        <Button type="submit" disabled={busy} className="h-11 justify-self-start px-5 text-base">
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {step === 'email' ? 'Next' : 'Save this sign-in'}
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
