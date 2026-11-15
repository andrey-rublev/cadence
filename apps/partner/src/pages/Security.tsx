import { ShieldCheck, ShieldOff } from 'lucide-react'
import { useState } from 'react'

import { Verdict } from '@/components/Brand'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, explain, type Me } from '@/lib/api'

/** Turning Cadence on is the person's choice, made on Cadence's own page (OAuth-style). */
export function Security({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      window.location.assign((await api<{ url: string }>('POST', '/cadence/connect')).url)
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  async function disconnect() {
    try {
      onMe(await api<Me>('POST', '/cadence/disconnect'))
    } catch (e) {
      setError(explain(e))
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <p className="text-sm text-muted-foreground">Account · {me.email}</p>
        <h1 className="text-3xl font-semibold">Security</h1>
      </div>

      <section className="grid gap-4 rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          {me.cadence.connected ? (
            <ShieldCheck className="mt-1 size-6 shrink-0 text-good" aria-hidden="true" />
          ) : (
            <ShieldOff className="mt-1 size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold">Second check with Cadence</h2>
            <p className="text-muted-foreground">
              {me.cadence.connected
                ? 'On. When you sign in or export, Cadence checks whether the typing and clicking look like you. When they do, there is no extra step.'
                : 'Off. Your account is protected by your password alone.'}
            </p>
          </div>
        </div>

        {!me.cadence.connected && (
          <ul className="grid gap-1.5 text-sm">
            <li>• Nothing extra at sign-in when it looks like you.</li>
            <li>• If it does not, Cadence asks you to confirm, with a quick test picked for you.</li>
            <li>• Northwind never receives your typing data; your browser sends it to Cadence.</li>
          </ul>
        )}

        {me.cadence.connected && me.sign_in_check && <Verdict check={me.sign_in_check} what="sign-in" />}

        <div className="flex flex-wrap gap-2">
          {me.cadence.connected ? (
            <Button variant="outline" onClick={disconnect} className="h-10 px-4">
              Turn off
            </Button>
          ) : (
            <Button size="lg" onClick={connect} disabled={busy} className="h-11 px-5 text-base">
              <ShieldCheck aria-hidden="true" />
              Protect with Cadence
            </Button>
          )}
        </div>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </section>
    </div>
  )
}
