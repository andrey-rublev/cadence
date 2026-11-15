import { recordActivity, type ActivityRecorder } from '@cadence/sdk'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, explain } from '@/lib/api'
import type { Me } from '@/lib/product'

const ACCOUNT_ERRORS = {
  username_taken: 'That username already has a Cadence account. Sign in instead.',
  invalid_username: 'Use 3 to 24 letters or numbers for the username.',
}

interface SignInProps {
  onSignedIn: (me: Me) => void
  /** Shown above the form, e.g. why this sign-in matters during setup. */
  note?: ReactNode
  initialMode?: 'login' | 'register'
}

/**
 * Cadence account sign-in. The typing on this form (zones and timing; the password field is
 * timing only) is sent with the sign-in: during setup it counts as one of the separate
 * sign-ins the profile needs.
 */
export function SignInForm({ onSignedIn, note, initialMode = 'login' }: SignInProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const recorder = useRef<ActivityRecorder | null>(null)
  const creating = mode === 'register'

  useEffect(() => {
    if (!form.current) return
    recorder.current = recordActivity({ root: form.current })
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
      setError(explain(e, ACCOUNT_ERRORS))
      setBusy(false)
    }
  }

  return (
    <form ref={form} onSubmit={submit} className="grid gap-5 rounded-xl border border-rule bg-card p-6 sm:p-8">
      {note}
      <Tabs value={mode} onValueChange={(v) => (setMode(v as 'login' | 'register'), setError(null))}>
        <TabsList className="h-10 w-full">
          <TabsTrigger value="login" className="text-base">
            Sign in
          </TabsTrigger>
          <TabsTrigger value="register" className="text-base">
            Create a Cadence account
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-1.5">
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
          className="h-11 text-base"
        />
      </div>
      <div className="grid gap-1.5">
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
          className="h-11 text-base"
        />
        {creating && (
          <p id="password-hint" className="text-sm text-muted-foreground">
            At least 8 characters. This is a demo, so do not reuse a real password.
          </p>
        )}
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" disabled={busy} className="h-12 text-base">
        {busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  )
}

/** The signed-out Cadence home page. */
export function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <div className="grid gap-6">
        <p className="font-mono text-sm text-muted-foreground">Behavioural second factor · hackathon prototype</p>
        <h1 className="text-5xl font-extrabold sm:text-6xl">Sign in as yourself, not just with your password.</h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          Cadence learns how you type and click in a three-minute setup. Sites that use Cadence then check the
          sign-in you were already doing. When it looks like you, there is no code to fetch. When it does not, you
          get a quick test picked for you, or another way to verify.
        </p>
        <ol className="grid max-w-prose gap-2">
          <li className="border-l-2 border-primary pl-3">Set up once here: a short click test and a typing test.</li>
          <li className="border-l-2 border-primary pl-3">Sign in a couple more times so Cadence sees more than one sitting.</li>
          <li className="border-l-2 border-primary pl-3">
            Connect a site. Each verified sign-in there makes the next check better informed.
          </li>
          <li className="border-l-2 border-rule pl-3 text-muted-foreground">
            Cadence never sees what you type, only key timing and which part of the keyboard. A failed check never
            locks you out.
          </li>
        </ol>
      </div>
      <div className="grid gap-4">
        <SignInForm onSignedIn={onSignedIn} />
        <p className="text-sm text-muted-foreground">
          Here to contribute typing data to the study?{' '}
          <a href="/collect" className="font-medium text-foreground underline">
            Open collection mode
          </a>
        </p>
      </div>
    </div>
  )
}
