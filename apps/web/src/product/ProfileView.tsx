import type { ChallengeResult, IssuedChallenge } from '@cadence/sdk'
import { useState } from 'react'

import { RoundRunner } from '@/challenge/RoundRunner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api, explain } from '@/lib/api'
import type { Me, Profile } from '@/lib/product'

import { Card, HistoryCard, ModelCard } from './EvidenceCards'
import { FallbackPanel } from './FallbackPanel'

function Progress({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="grid gap-1.5">
      <p className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {Math.min(value, total)} of {total}
        </span>
      </p>
      <span className="h-1.5 overflow-hidden rounded-full bg-rule" aria-hidden="true">
        <span className="block h-full bg-primary" style={{ width: `${Math.min(1, value / total) * 100}%` }} />
      </span>
    </div>
  )
}

/** Records one enrollment block: a practice round, then this sign-in's scored rounds. */
function Enrollment({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const [challenge, setChallenge] = useState<IssuedChallenge | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = me.profile.this_session
  const roundName = session.practice_done ? `round ${session.rounds + 1} of ${session.rounds_total}` : 'practice round'

  if (session.rounds >= session.rounds_total) {
    return (
      <p className="rounded-lg border border-rule bg-muted/60 p-4">
        This sign-in’s rounds are recorded.{' '}
        {me.profile.sufficient
          ? 'Your profile is ready.'
          : 'A profile needs rounds from at least two separate sign-ins, so that it reflects more than one sitting. Sign out, come back later and record the next session.'}
      </p>
    )
  }
  if (!me.trusted) {
    return (
      <div className="grid gap-3">
        <p>
          Recording needs trusted verification first. That way only the account’s owner can shape the profile
          that later checks rely on.
        </p>
        <FallbackPanel onVerified={({ me: updated }) => onMe(updated)} />
      </div>
    )
  }

  async function start() {
    setBusy(true)
    setError(null)
    try {
      setChallenge(await api.request<IssuedChallenge>('POST', '/challenges', { purpose: 'enroll' }))
    } catch (e) {
      setError(explain(e))
      // Trust may have lapsed since the page loaded; refresh so the right step shows.
      api.request<Me>('GET', '/me').then(onMe)
    }
    setBusy(false)
  }

  async function finish(result: ChallengeResult) {
    const id = challenge!.id
    setChallenge(null)
    setBusy(true)
    try {
      const saved = await api.submitChallenge<{ profile: Profile }>(id, result)
      onMe({ ...me, profile: saved.profile })
    } catch (e) {
      setError(explain(e))
    }
    setBusy(false)
  }

  return (
    <div className="grid gap-4">
      <RoundRunner
        challenge={challenge}
        idleText={
          session.practice_done
            ? 'Each round has a new layout. Move the way you normally would.'
            : 'A practice round first. It is never added to your profile.'
        }
        onComplete={finish}
      >
        <div className="grid max-w-sm justify-items-center gap-4 rounded-xl border border-rule bg-card/95 p-6 text-center shadow-sm">
          {error ? (
            <Alert variant="destructive" role="alert" className="text-left">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <p>Dig eight spots, carry three finds to the tray, then follow the marker. About 20 seconds.</p>
          )}
          <Button size="lg" onClick={start} disabled={busy} className="h-12 px-6 text-base">
            {busy ? 'One moment…' : `Start ${roundName}`}
          </Button>
        </div>
      </RoundRunner>
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
          Record how I move the pointer inside this app’s challenge rounds, and use it to check sensitive actions
          on my account.
        </span>
      </label>
      <label className={`flex items-start gap-3 ${me.consent ? 'cursor-pointer' : 'opacity-60'}`}>
        <Checkbox
          checked={me.keep_raw}
          disabled={!me.consent}
          onCheckedChange={(v) => save(true, v === true)}
          className="mt-1"
        />
        <span>Also keep my raw pointer paths, to help debug and retrain the model. Off by default.</span>
      </label>
      <p className="text-sm text-muted-foreground">
        Stored by default: movement measurements only, such as speeds, timings and how straight a path was.
        Never recorded: passwords, anything you type, or anything outside the challenge area. Kept for{' '}
        {me.retention_days} days at most.
      </p>

      <div className="grid gap-3 border-t border-rule pt-4">
        {!confirming ? (
          <Button variant="outline" onClick={() => setConfirming(true)} className="h-10 justify-self-start px-4 text-base">
            Delete my profile and recordings
          </Button>
        ) : me.trusted ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-2">This removes the profile and every stored round. It cannot be undone.</p>
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
  const { profile } = me
  return (
    <div className="grid gap-6">
      <div>
        <p className="font-mono text-sm text-muted-foreground">
          {profile.sufficient ? 'Profile ready' : 'Profile not finished'}
        </p>
        <h1 className="text-4xl font-extrabold">Movement profile</h1>
      </div>

      <Card title={profile.sufficient ? 'Your profile is ready' : 'Record your profile'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Progress label="Rounds recorded" value={profile.rounds} total={profile.rounds_needed} />
          <Progress label="Separate sign-ins" value={profile.sessions} total={profile.sessions_needed} />
        </div>
        {me.consent ? (
          <Enrollment me={me} onMe={onMe} />
        ) : (
          <p className="rounded-lg border border-dashed border-input bg-muted/60 p-4">
            Recording is off. Agree under “Consent and your data” below to start. Until then, exports ask for
            trusted verification every time.
          </p>
        )}
      </Card>

      <DataControls me={me} onMe={onMe} />
      <HistoryCard refreshKey={profile.rounds} />
      <ModelCard />
    </div>
  )
}
