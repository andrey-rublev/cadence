import type { ActivityRecorder } from '@cadence/sdk'
import { Loader2 } from 'lucide-react'
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
export function Login({ onSignedIn, notice, status }: { onSignedIn: (me: Me) => void; notice?: string | null; status?: string }) {
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
    <div className="grid min-h-dvh grid-rows-[1fr_auto] px-5">
      <main className="grid place-items-center py-12">
        <div className="grid w-full max-w-sm gap-6">
          <Logo />
          {notice && (
            <Alert variant="destructive">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {status && (
            <p role="status" className="rounded-xl border border-good/25 bg-good/8 px-4 py-3">
              {status}
            </p>
          )}
          <form ref={form} onSubmit={submit} className="grid gap-5 rounded-xl border border-border bg-card p-6 sm:p-7">
            <div className="grid gap-1">
              <h1 className="text-xl">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
              {mode === 'register' && <p className="text-sm text-muted-foreground">Any email works. Nothing is sent.</p>}
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
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    aria-describedby="password-hint"
                  />
                  <p id="password-hint" className="text-sm text-muted-foreground">
                    At least 8 characters.
                  </p>
                </div>
              </>
            )}

            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {redirecting && (
              <p className="text-sm text-muted-foreground" role="status">
                Cadence needs to confirm it’s you. Taking you there now.
              </p>
            )}

            <Button type="submit" size="lg" disabled={busy}>
              {busy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {mode === 'register' ? 'Create account' : step === 'email' ? 'Continue' : 'Sign in'}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground">
            {mode === 'login' ? 'New to Northwind? ' : 'Already have an account? '}
            <button
              type="button"
              onClick={() => (setMode(mode === 'login' ? 'register' : 'login'), setStep('email'), setError(null))}
              className="cursor-pointer rounded font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </div>
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border py-5 text-sm text-muted-foreground">
        <p>Northwind is a fictional company. All data here is invented.</p>
        <CadenceBadge />
      </footer>
    </div>
  )
}
