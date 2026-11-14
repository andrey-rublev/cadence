import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, explain } from '@/lib/api'
import type { Me } from '@/lib/product'

interface TrustStart {
  demo_code: string
  notice: string
  expires_in_s: number
}

interface TrustResult {
  grant: string | null
  me: Me
}

interface FallbackPanelProps {
  /** When set, a successful verification also clears this protected-action check. */
  verificationId?: string
  onVerified: (result: TrustResult) => void
}

/**
 * The trusted fallback. SIMULATED for the hackathon: the one-time code is shown on this
 * same screen, which proves nothing about the person. A real deployment would ask for a
 * passkey here. Every label says so.
 */
export function FallbackPanel({ verificationId, onVerified }: FallbackPanelProps) {
  const [issued, setIssued] = useState<TrustStart | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function getCode() {
    setBusy(true)
    setError(null)
    try {
      setIssued(await api.request<TrustStart>('POST', '/trust/start'))
      setCode('')
    } catch (e) {
      setError(explain(e))
    }
    setBusy(false)
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onVerified(
        await api.request<TrustResult>('POST', '/trust/verify', { code, verification_id: verificationId ?? null }),
      )
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 rounded-lg border border-dashed border-input bg-muted/60 p-5">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="grid gap-1">
          <p className="font-medium">Demo authenticator</p>
          <p className="text-sm text-muted-foreground">
            Simulated for the hackathon demo. This is not production authentication: a real deployment would
            ask for a passkey at this step.
          </p>
        </div>
      </div>

      {issued ? (
        <form onSubmit={verify} className="grid gap-3">
          <p className="rounded-md border border-rule bg-card px-4 py-3">
            <span className="block text-sm text-muted-foreground">Your one-time code (demo only)</span>
            <span className="font-mono text-3xl tracking-[0.3em]">{issued.demo_code}</span>
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="trust-code">Enter the code</Label>
            <Input
              id="trust-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="h-11 font-mono text-lg tracking-[0.3em]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={busy || code.length !== 6} className="h-11 px-5 text-base">
              {busy ? 'Checking…' : 'Verify'}
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={getCode} disabled={busy} className="h-11 px-4 text-base">
              Get a new code
            </Button>
          </div>
        </form>
      ) : (
        <Button size="lg" onClick={getCode} disabled={busy} className="h-11 justify-self-start px-5 text-base">
          {busy ? 'One moment…' : 'Get a code'}
        </Button>
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
