import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api, explain } from '@/lib/api'
import type { Me } from '@/lib/product'
import { FallbackPanel } from '@/product/FallbackPanel'

/** Consent and deleting everything. Deleting needs trusted verification. */
export function DataControls({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (agree: boolean) =>
    api.request<Me>('POST', '/consent', { agree, keep_raw: false }).then(onMe, (e) => setError(explain(e)))

  async function remove() {
    setError(null)
    try {
      onMe(await api.request<Me>('DELETE', '/profile'))
      setConfirming(false)
    } catch (e) {
      setError(explain(e))
    }
  }

  return (
    <section className="grid gap-3">
      <h2 className="text-lg">Privacy</h2>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        <label className="flex cursor-pointer items-start gap-3 px-5 py-4">
          <Checkbox checked={me.consent} onCheckedChange={(v) => save(v === true)} className="mt-0.5" />
          <span className="grid gap-0.5">
            <span className="font-medium">Record my key timing and pointer movement</span>
            <span className="text-sm text-muted-foreground">
              Used to check sign-ins and sensitive actions on Cadence and on sites you connect.
            </span>
          </span>
        </label>

        <div className="grid gap-4 px-5 py-4">
          {!confirming ? (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <p className="text-sm text-muted-foreground">
                Cadence keeps your profile’s timing measurements until you delete it, and everything else for up to{' '}
                {me.retention_days} days. Never what you type.
              </p>
              <Button variant="destructive" onClick={() => setConfirming(true)} className="shrink-0">
                Delete profile
              </Button>
            </div>
          ) : me.trusted ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>This removes your profile, every sample and every connected site. It can’t be undone.</p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={remove}>
                  Delete profile
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>Confirm it’s you before deleting your profile.</p>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
              <FallbackPanel onVerified={({ me: updated }) => onMe(updated)} />
            </div>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </section>
  )
}
