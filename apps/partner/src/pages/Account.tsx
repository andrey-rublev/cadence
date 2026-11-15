import { AlertDialog } from '@base-ui/react/alert-dialog'
import type { ActivityRecorder } from '@cadence/sdk'
import { useCallback, useId, useRef, useState, type FormEvent } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, evidenceToken, explain, recordActivity, type Me, type VerificationRequired } from '@/lib/api'

const DELETE_PHRASE = 'delete northwind'

interface AccountProps {
  me: Me
  onSecurity: () => void
  onDeleted: () => void
}

export function Account({ me, onSecurity, onDeleted }: AccountProps) {
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const recorder = useRef<ActivityRecorder | null>(null)
  const connected = me.cadence.connected
  const confirmed = confirmation === DELETE_PHRASE

  const recordConfirmation = useCallback((input: HTMLInputElement | null) => {
    if (!input) return
    const activity = recordActivity({ root: input })
    recorder.current = activity
    return () => {
      activity.stop()
      recorder.current = null
    }
  }, [])

  async function confirmDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!connected || !confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ status: 'deleted' } | VerificationRequired>('POST', '/account/delete', {
        confirmation,
        evidence: await evidenceToken(recorder.current),
      })
      if (result.status === 'verify') {
        window.location.assign(result.verify_url)
        return
      }
      onDeleted()
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-2xl">Account</h1>

      <dl className="grid gap-1 rounded-xl border border-border bg-card p-6">
        <dt className="text-sm font-medium text-muted-foreground">Email address</dt>
        <dd className="break-all text-base font-medium">{me.email}</dd>
      </dl>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-card p-6">
        <div className="grid gap-1.5">
          <h2 className="text-lg">Delete account</h2>
          <p className="text-muted-foreground">Permanently delete your Northwind account and export history.</p>
        </div>

        <AlertDialog.Root
          onOpenChange={(open, event) => {
            if (!open && busy) event.cancel()
            if (open) {
              setConfirmation('')
              setError(null)
              recorder.current?.reset()
            }
          }}
        >
          <AlertDialog.Trigger render={<Button variant="destructive" />}>
            Delete account
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
            <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl outline-none">
              <AlertDialog.Title className="text-lg">Delete your Northwind account?</AlertDialog.Title>
              <AlertDialog.Description className="text-muted-foreground">
                {connected
                  ? 'This permanently deletes your Northwind account and export history and signs you out on all devices.'
                  : 'Connect Cadence in Security to verify it’s you before deleting your account.'}
              </AlertDialog.Description>
              <form className="grid gap-4" onSubmit={confirmDeletion}>
                {connected && (
                  <div className="grid gap-2">
                    <Label htmlFor={inputId} className="flex-wrap">
                      Type <strong className="font-mono">{DELETE_PHRASE}</strong> to confirm.
                    </Label>
                    <Input
                      id={inputId}
                      ref={recordConfirmation}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      onPaste={() => recorder.current?.reset()}
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={busy}
                    />
                  </div>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <AlertDialog.Close render={<Button type="button" variant="outline" disabled={busy} />}>
                    Cancel
                  </AlertDialog.Close>
                  {connected ? (
                    <Button type="submit" variant="destructive" disabled={!confirmed || busy}>
                      {busy ? 'Checking with Cadence…' : 'Delete account'}
                    </Button>
                  ) : (
                    <Button type="button" onClick={onSecurity}>Open Security</Button>
                  )}
                </div>
              </form>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </section>
    </div>
  )
}
