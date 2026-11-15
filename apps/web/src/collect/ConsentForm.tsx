import { CadenceApiError } from '@cadence/sdk'
import { useState, type FormEvent } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api, explain, type CollectStatus } from '@/lib/api'

const STATION_KEY = 'cadence.station'

const DEVICES = [
  { value: 'laptop-keys', label: 'Laptop keyboard' },
  { value: 'external-keys', label: 'Separate keyboard' },
  { value: 'other', label: 'Other' },
]

function Choice({ value, label }: { value: string; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-base has-data-checked:border-primary has-data-checked:bg-accent">
      <RadioGroupItem value={value} />
      {label}
    </label>
  )
}

export function ConsentForm({ onStarted }: { onStarted: (status: CollectStatus) => void }) {
  const [returning, setReturning] = useState('no')
  const [username, setUsername] = useState('')
  const [device, setDevice] = useState('laptop-keys')
  const [station, setStation] = useState(() => localStorage.getItem(STATION_KEY) ?? '')
  const [error, setError] = useState<string | null>(null)
  /** The typed username has no sessions on this laptop; offer to continue anyway. */
  const [unknown, setUnknown] = useState(false)
  const [busy, setBusy] = useState(false)

  async function start(earlierSessionElsewhere: boolean) {
    setBusy(true)
    setError(null)
    setUnknown(false)
    try {
      localStorage.setItem(STATION_KEY, station.trim())
      const status = await api.request<CollectStatus>('POST', '/collect/start', {
        consent: true,
        username,
        returning: returning === 'yes',
        earlier_session_elsewhere: earlierSessionElsewhere,
        declared_device: device,
        station: station.trim(),
      })
      onStarted(status)
    } catch (e) {
      setError(explain(e))
      setUnknown(e instanceof CadenceApiError && e.code === 'unknown_username')
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    start(false)
  }

  return (
    <form onSubmit={submit} className="grid gap-6 rounded-xl border border-rule bg-card p-6 sm:p-8">
      <fieldset>
        <legend className="mb-2.5 font-medium">Have you done a session before?</legend>
        <RadioGroup value={returning} onValueChange={(v) => setReturning(v as string)} className="grid grid-cols-2 gap-2.5">
          <Choice value="no" label="No, first time" />
          <Choice value="yes" label="Yes" />
        </RadioGroup>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="username">{returning === 'yes' ? 'Your username' : 'Choose a username'}</Label>
        <Input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="molefan42"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={24}
          className="h-11 font-mono text-lg"
        />
      </div>

      <fieldset>
        <legend className="mb-2.5 font-medium">What are you typing on right now?</legend>
        <RadioGroup value={device} onValueChange={(v) => setDevice(v as string)} className="grid gap-2.5 sm:grid-cols-3">
          {DEVICES.map((d) => (
            <Choice key={d.value} {...d} />
          ))}
        </RadioGroup>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="station">Station</Label>
        <Input
          id="station"
          value={station}
          onChange={(e) => setStation(e.target.value)}
          placeholder="laptop-1"
          required
          maxLength={40}
          autoComplete="off"
          className="h-10"
        />
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {error}
            {unknown && (
              <Button
                type="button"
                variant="link"
                onClick={() => start(true)}
                className="mt-1 h-auto p-0 text-left whitespace-normal text-destructive underline"
              >
                My earlier session was on a different laptop. Continue as {username.trim().toLowerCase()}.
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-2">
        <p id="collection-consent" className="text-sm text-muted-foreground">
          You will type short answers for about three minutes. We record when each key goes down and up and which
          part of the keyboard it is on, never the text, for training and testing.
        </p>
        <Button type="submit" size="lg" disabled={busy} aria-describedby="collection-consent" className="h-12 text-base">
          {busy ? 'Starting…' : 'Agree and start session'}
        </Button>
      </div>
    </form>
  )
}
