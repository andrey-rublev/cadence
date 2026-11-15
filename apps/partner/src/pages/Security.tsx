import type { ActivityRecorder } from '@cadence/sdk'
import { ShieldCheck } from 'lucide-react'
import { useState, type RefObject } from 'react'

import { PracticeSignIns } from '@/components/PracticeSignIns'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, explain, type Me } from '@/lib/api'

/** Turning Cadence on is the person's choice, made on Cadence's own page (OAuth-style). */
export function Security({
  me,
  onMe,
  pageRecorder,
}: {
  me: Me
  onMe: (me: Me) => void
  pageRecorder: RefObject<ActivityRecorder | null>
}) {
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

  const on = me.cadence.connected
  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-2xl">Security</h1>

      <section className="grid gap-5 rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between sm:gap-8">
          <div className="grid gap-1.5">
            <h2 className="flex items-center gap-2.5 text-lg">
              Cadence
              <span
                className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${on ? 'bg-good/12 text-good' : 'bg-muted text-muted-foreground'}`}
              >
                {on ? 'On' : 'Off'}
              </span>
            </h2>
            <p className="text-muted-foreground">
              {on
                ? 'Cadence checks how you type when you sign in, export, or delete your account. When it looks like you, there is no extra step.'
                : 'Connect Cadence to protect sign-ins and exports and enable account deletion. Cadence handles your typing data.'}
            </p>
          </div>
          {on ? (
            <Button variant="outline" onClick={disconnect} className="shrink-0">
              Turn off
            </Button>
          ) : (
            <Button size="lg" onClick={connect} disabled={busy} className="shrink-0">
              <ShieldCheck aria-hidden="true" />
              Protect with Cadence
            </Button>
          )}
        </div>

        {on && <PracticeSignIns pageRecorder={pageRecorder} />}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </section>
    </div>
  )
}
