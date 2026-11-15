import { Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Wordmark } from '@/components/Wordmark'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, explain } from '@/lib/api'
import type { Me } from '@/lib/product'

import { SignInForm } from './SignIn'

/**
 * A site asks to use Cadence for this person (OAuth-style). The person signs in to Cadence if
 * needed, sees exactly what the site will and will not get, and approves. The site receives
 * a one-time code it exchanges, server to server, for an opaque identifier.
 */
export function ConnectPage() {
  const params = new URLSearchParams(window.location.search)
  const siteKey = params.get('site_key') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const state = params.get('state') ?? ''
  const [site, setSite] = useState<{ name: string } | null>(null)
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .request<{ name: string }>('GET', `/sites/${encodeURIComponent(siteKey)}?redirect_uri=${encodeURIComponent(redirectUri)}`)
      .then(setSite, (e) =>
        setError(explain(e, { unknown_site: 'This site is not registered with Cadence.', redirect_not_allowed: 'This link was not issued by a registered site.' })),
      )
    api.request<Me | null>('GET', '/me').then(setMe, () => setMe(null))
  }, [siteKey, redirectUri])

  async function approve() {
    setBusy(true)
    setError(null)
    try {
      const out = await api.request<{ redirect: string }>('POST', '/sites/connect', {
        site_key: siteKey,
        redirect_uri: redirectUri,
        state,
      })
      window.location.assign(out.redirect)
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  const cancel = () => window.location.assign(`${redirectUri}?${new URLSearchParams({ error: 'cancelled', state })}`)

  return (
    <div className="mx-auto grid min-h-svh w-full max-w-2xl content-start gap-8 px-5 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <Wordmark />
        <span className="font-mono text-sm text-muted-foreground">Connect a site</span>
      </header>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {site && me === null && (
        <div className="grid gap-4">
          <h1 className="text-3xl font-extrabold">Sign in to Cadence to connect {site.name}.</h1>
          <SignInForm onSignedIn={setMe} />
        </div>
      )}

      {site && me && (
        <main className="grid gap-6 rounded-xl border border-rule bg-card p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <Link2 className="mt-2 size-6 shrink-0 text-primary" aria-hidden="true" />
            <div className="grid gap-1">
              <h1 className="text-3xl font-extrabold">{site.name} wants to use Cadence for your account.</h1>
              <p className="text-muted-foreground">Signed in to Cadence as {me.username}.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid content-start gap-2 rounded-lg border border-rule p-4">
              <p className="font-medium">{site.name} will be able to</p>
              <ul className="grid list-disc gap-1 pl-5 text-sm">
                <li>ask Cadence whether a sign-in or sensitive action looks like you</li>
                <li>see the result and how sure Cadence was</li>
              </ul>
            </div>
            <div className="grid content-start gap-2 rounded-lg border border-rule p-4">
              <p className="font-medium">{site.name} will not get</p>
              <ul className="grid list-disc gap-1 pl-5 text-sm">
                <li>your typing or pointer data: your browser sends it to Cadence directly</li>
                <li>your Cadence username or password</li>
              </ul>
            </div>
          </div>
          {me.setup.complete ? (
            <p className="text-sm text-muted-foreground">
              Next, back on {site.name}, you type your {site.name} email and password a few times so Cadence learns
              how you sign in there.
            </p>
          ) : (
            <p className="rounded-lg border border-uncertain/50 bg-uncertain/8 p-4 text-sm">
              Your Cadence setup is not finished, so until it is, {site.name} will ask you to verify another way.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={approve} disabled={busy} className="h-11 px-5 text-base">
              {busy ? 'Connecting…' : `Connect ${site.name}`}
            </Button>
            <Button variant="ghost" size="lg" onClick={cancel} className="h-11 px-5 text-base">
              Cancel
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">You can disconnect at any time from your Cadence home page.</p>
        </main>
      )}
    </div>
  )
}
