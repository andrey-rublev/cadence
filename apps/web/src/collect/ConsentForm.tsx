import { CadenceApiError } from '@cadence/sdk'
import { useState, type FormEvent } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api, explain, type CollectStatus } from '@/lib/api'

const STATION_KEY = 'cadence.station'

const DEVICES = [
  { value: 'mouse', label: 'Mouse' },
  { value: 'trackpad', label: 'Trackpad' },
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
  const [device, setDevice] = useState('mouse')
  const [station, setStation] = useState(() => localStorage.getItem(STATION_KEY) ?? '')
  const [pilot, setPilot] = useState(false)
  const [consent, setConsent] = useState(false)
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
        consent,
        username,
        returning: returning === 'yes',
        earlier_session_elsewhere: earlierSessionElsewhere,
        declared_device: device,
        station: station.trim(),
        is_pilot: pilot,
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
          aria-describedby="username-hint"
          className="h-11 font-mono text-lg"
        />
        <p id="username-hint" className="text-sm text-muted-foreground">
          {returning === 'yes'
            ? 'The same one you used last time, so your sessions are matched up.'
            : '3 to 24 letters or numbers. Not your real name. You will type it again if you come back.'}
        </p>
      </div>

      <fieldset>
        <legend className="mb-2.5 font-medium">What are you pointing with right now?</legend>
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
        <p className="text-sm text-muted-foreground">
          Set once by the team for each laptop. It lets us compare different people on the same device.
        </p>
      </div>

      <div className="grid gap-3 border-t border-rule pt-5">
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-1" />
          <span>
            I agree to my pointer movement on this page being recorded and used to train and test
            this prototype.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-muted-foreground">
          <Checkbox checked={pilot} onCheckedChange={(v) => setPilot(v === true)} className="mt-1" />
          <span>I'm on the Cadence team. Keep this run out of the results.</span>
        </label>
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

      <Button type="submit" size="lg" disabled={!consent || busy} className="h-12 text-base">
        {busy ? 'Starting…' : 'Start session'}
      </Button>
    </form>
  )
}
