import { useState, type FormEvent } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, explain } from '@/lib/api'
import type { Me } from '@/lib/product'

const ACCOUNT_ERRORS = {
  username_taken: 'That username already has an account. Sign in instead.',
  invalid_username: 'Use 3 to 24 letters or numbers for the username.',
}

export function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const creating = mode === 'register'

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await api.request<Me>('POST', `/auth/${mode}`, { username, password }))
    } catch (e) {
      setError(explain(e, ACCOUNT_ERRORS))
      setBusy(false)
    }
  }

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <div className="grid gap-6">
        <p className="font-mono text-sm text-muted-foreground">Demo workspace · hackathon prototype</p>
        <h1 className="text-5xl font-extrabold sm:text-6xl">A second check, made from how you move.</h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          A stolen password or an unlocked laptop gets someone into an account. Cadence adds a check they
          cannot copy from a sticky note: it compares how the pointer moves with a profile the owner recorded,
          and asks for stronger verification when a sensitive action does not look like them.
        </p>
        <ul className="grid max-w-prose gap-2">
          <li className="border-l-2 border-primary pl-3">It is an extra signal. Your normal sign-in stays as it is.</li>
          <li className="border-l-2 border-primary pl-3">A failed check never locks you out. There is always another way to verify.</li>
          <li className="border-l-2 border-rule pl-3 text-muted-foreground">
            Everything in this workspace is fictional, including the customers and the fallback authenticator.
          </li>
        </ul>
      </div>

      <form onSubmit={submit} className="grid gap-5 rounded-xl border border-rule bg-card p-6 sm:p-8">
        <Tabs value={mode} onValueChange={(v) => (setMode(v as string), setError(null))}>
          <TabsList className="h-10 w-full">
            <TabsTrigger value="login" className="text-base">
              Sign in
            </TabsTrigger>
            <TabsTrigger value="register" className="text-base">
              Create account
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

        <p className="border-t border-rule pt-4 text-sm text-muted-foreground">
          Here to contribute pointer data to the study?{' '}
          <a href="/collect" className="font-medium text-foreground underline">
            Open collection mode
          </a>
        </p>
      </form>
    </div>
  )
}
