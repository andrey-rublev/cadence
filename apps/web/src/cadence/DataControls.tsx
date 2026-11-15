import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api, explain } from '@/lib/api'
import type { Me } from '@/lib/product'
import { Card } from '@/product/EvidenceCards'
import { FallbackPanel } from '@/product/FallbackPanel'

/** Consent, raw-data opt-in and deleting everything. Deleting needs trusted verification. */
export function DataControls({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (agree: boolean, keepRaw: boolean) =>
    api.request<Me>('POST', '/consent', { agree, keep_raw: keepRaw }).then(onMe, (e) => setError(explain(e)))

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
    <Card title="Consent and your data">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox checked={me.consent} onCheckedChange={(v) => save(v === true, me.keep_raw)} className="mt-1" />
        <span>
          Record the timing of my typing and how I move the pointer on Cadence and on sites I connect, and use them to
          check sign-ins and sensitive actions there.
        </span>
      </label>
      <label className={`flex items-start gap-3 ${me.consent ? 'cursor-pointer' : 'opacity-60'}`}>
        <Checkbox checked={me.keep_raw} disabled={!me.consent} onCheckedChange={(v) => save(true, v === true)} className="mt-1" />
        <span>Also keep the raw timing and pointer paths from Cadence pages, to help debug and retrain the model. Off by default.</span>
      </label>
      <p className="text-sm text-muted-foreground">
        Stored by default: measurements only, such as key hold times, gaps between keys and how straight a pointer path
        was. Never recorded: what you type, which keys of a password you press (only their timing), or anything outside
        those pages. Kept for {me.retention_days} days at most.
      </p>

      <div className="grid gap-3 border-t border-rule pt-4">
        {!confirming ? (
          <Button variant="outline" onClick={() => setConfirming(true)} className="h-10 justify-self-start px-4 text-base">
            Delete my profile and recordings
          </Button>
        ) : me.trusted ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-2">
              This removes the profile, every stored sample and every connected site. It cannot be undone.
            </p>
            <Button variant="destructive" onClick={remove} className="h-10 px-4 text-base">
              Delete profile
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} className="h-10 px-4 text-base">
              Keep it
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <p>Deleting the profile needs trusted verification, so nobody else can remove your protection.</p>
            <FallbackPanel onVerified={({ me: updated }) => onMe(updated)} />
          </div>
        )}
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </Card>
  )
}
