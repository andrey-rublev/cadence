import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, explain } from '@/lib/api'
import { MODALITY_LABEL, type Me, type Modality } from '@/lib/product'

import { Card, HistoryCard, PassiveModelsCard } from './EvidenceCards'
import { FallbackPanel } from './FallbackPanel'
import { Meter, NextSample } from './PassiveCapture'

const PROMPT =
  'Describe your last working day: what you did first, who you talked to, and what is still on your list.'

function ModalityProgress({ modality, me }: { modality: Modality; me: Me }) {
  const status = me.passive[modality]
  return (
    <div className="grid content-start gap-3 rounded-lg border border-rule p-4">
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{MODALITY_LABEL[modality]}</span>
        <span className="font-mono text-xs text-muted-foreground">{status.sufficient ? 'ready' : 'learning'}</span>
      </p>
      <Meter label="Samples" value={status.windows} total={status.windows_needed} />
      <Meter label="Separate sign-ins" value={status.sessions} total={status.sessions_needed} />
    </div>
  )
}

/** Learning happens while the person works. A trusted verification opens a 15-minute window. */
function Learning({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const ready = me.passive.keys.sufficient || me.passive.pointer.sufficient
  const [text, setText] = useState('')

  if (!me.trusted) {
    return (
      <div className="grid gap-3">
        <p>
          Each learning session starts with trusted verification, so only the account’s owner shapes the profile that
          later checks rely on. After that, Cadence learns for 15 minutes while you work normally.
        </p>
        <FallbackPanel onVerified={({ me: updated }) => onMe(updated)} />
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      <p>
        Learning now. Work as you normally would: search customers, write notes, click around. To speed it up, type
        here and click through the list.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="practice">Typing practice</Label>
        <Textarea
          id="practice"
          rows={4}
          placeholder={PROMPT}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="text-base"
        />
        <p className="text-xs text-muted-foreground">
          What you type stays in this page. Cadence records when keys go down and up and which part of the keyboard
          they are on, never the characters.
        </p>
      </div>
      <NextSample />
      {ready && (
        <p className="text-sm text-muted-foreground">
          This sign-in is teaching the profile, so exports in it are not checked against it. To see a check, sign out
          and sign back in without the demo authenticator, work for a minute, then export.
        </p>
      )}
    </div>
  )
}

function DataControls({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
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
          While I use this app, record how I move the pointer and the timing of my typing, and use them to check
          sensitive actions on my account.
        </span>
      </label>
      <label className={`flex items-start gap-3 ${me.consent ? 'cursor-pointer' : 'opacity-60'}`}>
        <Checkbox
          checked={me.keep_raw}
          disabled={!me.consent}
          onCheckedChange={(v) => save(true, v === true)}
          className="mt-1"
        />
        <span>Also keep the raw timing and pointer paths, to help debug and retrain the model. Off by default.</span>
      </label>
      <p className="text-sm text-muted-foreground">
        Stored by default: measurements only, such as key hold times, gaps between keys and how straight a pointer path
        was. Never recorded: what you type, passwords (only their timing, and not even which part of the keyboard), or
        anything outside this app. You can pause capture from the header at any time. Kept for {me.retention_days}{' '}
        days at most.
      </p>

      <div className="grid gap-3 border-t border-rule pt-4">
        {!confirming ? (
          <Button variant="outline" onClick={() => setConfirming(true)} className="h-10 justify-self-start px-4 text-base">
            Delete my profile and recordings
          </Button>
        ) : me.trusted ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-2">This removes the profile and every stored sample. It cannot be undone.</p>
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

export function ProfileView({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const ready = me.passive.keys.sufficient || me.passive.pointer.sufficient
  const samples = me.passive.keys.windows + me.passive.pointer.windows
  return (
    <div className="grid gap-6">
      <div>
        <p className="font-mono text-sm text-muted-foreground">{ready ? 'Profile ready' : 'Profile not finished'}</p>
        <h1 className="text-4xl font-extrabold">Behaviour profile</h1>
      </div>

      <Card title={ready ? 'Your profile is ready' : 'Build your profile'}>
        <p className="text-muted-foreground">
          No game to play. Cadence learns your typing rhythm and pointer movement while you use the app, from at least
          two separate sign-ins so the profile reflects more than one sitting. Either kind of input is enough to check
          an export.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ModalityProgress modality="keys" me={me} />
          <ModalityProgress modality="pointer" me={me} />
        </div>
        {me.consent ? (
          <Learning me={me} onMe={onMe} />
        ) : (
          <p className="rounded-lg border border-dashed border-input bg-muted/60 p-4">
            Capture is off. Agree under “Consent and your data” below to start. Until then, exports ask for trusted
            verification every time.
          </p>
        )}
      </Card>

      <DataControls me={me} onMe={onMe} />
      <HistoryCard refreshKey={samples} />
      <PassiveModelsCard />
    </div>
  )
}
