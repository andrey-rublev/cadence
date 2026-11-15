import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Shell } from '@/components/Shell'
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
    <Shell width="narrow">
      <div className="grid gap-5">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {site && me === null && (
          <SignInForm onSignedIn={setMe} note={<p className="text-muted-foreground">Sign in to connect {site.name}.</p>} />
        )}

        {!error && (!site || me === undefined) && (
          <div aria-busy className="grid gap-3">
            <span className="h-8 w-64 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="h-4 w-80 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        )}

        {site && me && (
          <section className="grid animate-in gap-7 duration-300 fill-mode-both fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
            <div className="grid gap-3">
              <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                Signed in as {me.username}
              </p>
              <h1 className="text-3xl">Connect {site.name}</h1>
              <p className="text-muted-foreground">
                {site.name} will ask Cadence to check that it’s you when you sign in there.
              </p>
            </div>

            <dl className="grid border-b border-border *:grid *:gap-x-5 *:gap-y-1 *:border-t *:border-border *:py-3.5 sm:*:grid-cols-[6.5rem_1fr]">
              <div>
                <dt className="font-medium">It can</dt>
                <dd className="grid gap-1.5 text-muted-foreground">
                  <span>Ask whether a sign-in looks like you.</span>
                  <span>See the result of each check.</span>
                </dd>
              </div>
              <div>
                <dt className="font-medium">It never sees</dt>
                <dd className="grid gap-1.5 text-muted-foreground">
                  <span>Your typing or pointer data.</span>
                  <span>Your Cadence username or password.</span>
                </dd>
              </div>
              <div>
                <dt className="font-medium">Next</dt>
                {me.setup.complete ? (
                  <dd className="text-muted-foreground">
                    {site.name} asks you to type your sign-in there a few times, so Cadence can learn it.
                  </dd>
                ) : (
                  <dd className="text-uncertain">
                    Your Cadence setup isn’t finished. Until it is, {site.name} will ask you to verify another way.
                  </dd>
                )}
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" onClick={approve} disabled={busy}>
                Connect
                <ArrowRight
                  aria-hidden="true"
                  className="transition-transform duration-150 group-hover/button:translate-x-0.5 motion-reduce:transition-none"
                />
              </Button>
              <Button variant="ghost" size="lg" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </section>
        )}
      </div>
    </Shell>
  )
}
