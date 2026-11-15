import type { ActivityRecorder } from '@cadence/sdk'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { CadenceBadge, Logo } from '@/components/Brand'
import { SignInFields, type SignInStep } from '@/components/SignInFields'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, evidenceToken, explain, recordActivity, type Gate, type Me } from '@/lib/api'

/**
 * Northwind's sign-in: email, then password, on two screens of one form. Nothing here asks the
 * person to do anything for Cadence: the typing and clicking they do anyway, across both
 * screens, is recorded in the browser and sent to Cadence on submit.
 */
export function Login({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [step, setStep] = useState<SignInStep>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const recorder = useRef<ActivityRecorder | null>(null)

  useEffect(() => {
    recorder.current = recordActivity({ root: form.current ?? undefined })
    return () => recorder.current?.stop()
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mode === 'login' && step === 'email') {
      setStep('password')
      setError(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const evidence = mode === 'login' ? await evidenceToken(recorder.current) : null
      const out = await api<Gate<{ me: Me }>>('POST', mode === 'login' ? '/login' : '/register', { email, password, evidence })
      if (out.status === 'verify') {
        setRedirecting(true)
        window.location.assign(out.verify_url)
        return
      }
      onSignedIn(out.me)
    } catch (e) {
      setPassword('')
      setError(explain(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      <aside className="hidden flex-col justify-between bg-chrome p-10 text-chrome-foreground lg:flex">
        <Logo inverted />
        <div className="grid max-w-md gap-4">
          <p className="font-heading text-3xl font-semibold leading-tight">Every customer relationship, one quiet workspace.</p>
          <p className="text-chrome-foreground/75">
            Northwind is a fictional CRM used to demonstrate Cadence. Customers, contacts and figures here are invented.
          </p>
        </div>
        <CadenceBadge className="text-chrome-foreground/80" />
      </aside>

      <main className="grid place-items-center px-5 py-10">
        <form ref={form} onSubmit={submit} className="grid w-full max-w-sm gap-5">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="grid gap-1">
            <h1 className="text-3xl font-semibold">{mode === 'login' ? 'Sign in' : 'Create your workspace'}</h1>
            <p className="text-muted-foreground">
              {mode === 'login' ? 'Welcome back.' : 'Use any email; this is a demo and nothing is sent.'}
            </p>
          </div>

          {mode === 'login' ? (
            <SignInFields
              id="sign-in"
              step={step}
              email={email}
              password={password}
              onEmail={setEmail}
              onPassword={setPassword}
              onChangeEmail={() => (setStep('email'), setPassword(''), recorder.current?.reset())}
            />
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="h-11 text-base"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="h-11 text-base"
                />
              </div>
            </>
          )}

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {redirecting && (
            <p className="rounded-lg border border-border bg-card p-3 text-sm" role="status">
              Cadence wants to confirm it’s you. Taking you there…
            </p>
          )}

          <Button type="submit" size="lg" disabled={busy} className="h-11 text-base">
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {mode === 'register' ? 'Create account' : step === 'email' ? 'Next' : 'Sign in'}
            {!busy && <ArrowRight aria-hidden="true" />}
          </Button>

          <p className="text-sm text-muted-foreground">
            {mode === 'login' ? 'New to Northwind? ' : 'Already have an account? '}
            <button
              type="button"
              onClick={() => (setMode(mode === 'login' ? 'register' : 'login'), setStep('email'), setError(null))}
              className="cursor-pointer font-medium text-foreground underline underline-offset-4"
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          <CadenceBadge className="text-muted-foreground lg:hidden" />
        </form>
      </main>
    </div>
  )
}
