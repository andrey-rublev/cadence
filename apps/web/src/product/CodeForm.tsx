import { useState, type FormEvent } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { explain } from '@/lib/api'

interface CodeFormProps {
  id: string
  /** Asks the server for a code and returns it. */
  issue: () => Promise<string>
  /** Submits the typed code; resolves when it was accepted. */
  verify: (code: string) => Promise<void>
}

/**
 * Verifying with a one-time code. SIMULATED in this prototype: the code is shown on this same
 * screen, which proves nothing about the person. A real deployment would ask for a passkey.
 */
export function CodeForm({ id, issue, verify }: CodeFormProps) {
  const [issued, setIssued] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function getCode() {
    setBusy(true)
    setError(null)
    try {
      setIssued(await issue())
      setCode('')
    } catch (e) {
      setError(explain(e))
    }
    setBusy(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await verify(code)
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="font-medium">Verify with a code</p>
        <p className="text-sm text-muted-foreground">
          Simulated in this prototype: the code appears here instead of on a device you own.
        </p>
      </div>

      {issued ? (
        <form onSubmit={submit} className="grid gap-4">
          <p className="rounded-lg bg-muted/70 px-4 py-3 font-mono text-2xl tracking-[0.25em]">
            <span className="sr-only">Your code is </span>
            {issued}
          </p>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-code`}>Enter the code</Label>
            <Input
              id={`${id}-code`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="max-w-48 font-mono tracking-[0.25em]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
              Verify
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={getCode} disabled={busy}>
              New code
            </Button>
          </div>
        </form>
      ) : (
        <Button size="lg" variant="outline" onClick={getCode} disabled={busy} className="justify-self-start">
          Get a code
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
