import { ExternalLink, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { api, explain } from '@/lib/api'
import { ACTION_LABEL, MODALITY_LABEL, OUTCOME_LABEL, type Me, type MySites, type SiteCheckRecord } from '@/lib/product'
import { Card, PassiveModelsCard } from '@/product/EvidenceCards'
import { DataControls } from './DataControls'

const PARTNER_URL = import.meta.env.VITE_PARTNER_URL ?? 'http://localhost:5180'

const RESOLVED: Record<NonNullable<SiteCheckRecord['resolved_by']>, string> = {
  behavior: 'Passed from the sign-in itself',
  test: 'Passed a quick test',
  fallback: 'Verified with the authenticator',
}

function when(at: number) {
  return new Date(at * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function Stat({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="grid content-start gap-1 rounded-lg border border-rule p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-heading text-3xl font-bold">{value}</p>
      <p className="text-sm text-muted-foreground">{note}</p>
    </div>
  )
}

/** The home page once setup is done: what the profile holds, which sites use it, and every check. */
export function Dashboard({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const [sites, setSites] = useState<MySites | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.request<MySites>('GET', '/sites').then(setSites, (e) => setError(explain(e)))
  }, [])

  async function disconnect(id: number) {
    try {
      setSites(await api.request<MySites>('DELETE', `/sites/${id}`))
    } catch (e) {
      setError(explain(e))
    }
  }

  const learned = sites?.checks.filter((c) => c.learned).length ?? 0
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <p className="font-mono text-sm text-muted-foreground">Cadence is set up · {me.username}</p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">Your sign-ins now carry a second check.</h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          When you connect a site, you type that site’s own sign-in a few times so Cadence learns it. After that, the
          site sends Cadence the timing of each sign-in, and every one that passes, or that you confirm, joins your
          profile.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Typing samples" value={me.passive.keys.windows} note="From the typing test and verified use" />
        <Stat label="Click samples" value={me.passive.pointer.windows} note="From the click test and verified use" />
        <Stat label="Sign-ins learned" value={me.passive.keys.sessions} note={`${learned} from connected sites`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Connected sites">
          {sites && sites.sites.length === 0 && (
            <p className="text-muted-foreground">
              No sites yet. On a site that supports Cadence, choose “Protect with Cadence” in its security settings.
            </p>
          )}
          <ul className="grid gap-2">
            {sites?.sites.map((site) => (
              <li key={site.id} className="flex items-center justify-between gap-3 rounded-lg border border-rule px-4 py-3">
                <span className="grid">
                  <span className="font-medium">{site.name}</span>
                  <span className="text-sm text-muted-foreground">Connected {when(site.since)}</span>
                  <span className="text-sm text-muted-foreground">{signInHistory(site, sites.sign_ins_compared)}</span>
                </span>
                <Button variant="ghost" onClick={() => disconnect(site.id)} className="h-10 px-3 text-sm">
                  <Unplug aria-hidden="true" />
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
          <a
            href={PARTNER_URL}
            className="inline-flex items-center gap-1.5 justify-self-start text-sm font-medium underline underline-offset-4"
          >
            Try it on the demo site, Northwind CRM
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </Card>

        <Card title="Recent checks">
          {sites && sites.checks.length === 0 && <p className="text-muted-foreground">No checks yet.</p>}
          <ul className="grid gap-2">
            {sites?.checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
        </Card>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DataControls me={me} onMe={onMe} />
      <PassiveModelsCard />
    </div>
  )
}

function signInHistory(
  { sign_ins_remembered: have, sign_ins_needed: need }: MySites['sites'][number],
  compared: boolean,
): string {
  const kept = `${have} sign-in${have === 1 ? '' : 's'} on this site kept`
  if (!compared) return `${kept}. Comparing new sign-ins with them is off until it is shown to help.`
  if (have >= need) return `${kept}; new sign-ins are also compared with your latest ones.`
  return `${kept}; from ${need}, new sign-ins are also compared with them.`
}

function CheckRow({ check }: { check: SiteCheckRecord }) {
  const scored = check.decision.parts.filter((p) => p.score !== null)
  const earlier = check.decision.parts.find((p) => p.earlier_sign_ins)?.earlier_sign_ins
  return (
    <li className="grid gap-1 rounded-lg border border-rule px-4 py-3">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">
          {check.site} · {ACTION_LABEL[check.action] ?? check.action}
        </span>
        <span className="text-sm text-muted-foreground">{when(check.at)}</span>
      </p>
      <p className="text-sm">
        {OUTCOME_LABEL[check.decision.outcome]}
        {scored.length > 0 && (
          <span className="text-muted-foreground">
            {' '}
            ({scored.map((p) => `${MODALITY_LABEL[p.modality].toLowerCase()} ${p.score?.toFixed(2)}`).join(', ')})
          </span>
        )}
        {earlier && <span className="text-muted-foreground"> · compared with {earlier} earlier sign-ins</span>}
        {' · '}
        {check.resolved_by ? RESOLVED[check.resolved_by] : 'Not confirmed'}
        {check.learned && <span className="text-consistent"> · added to profile</span>}
      </p>
    </li>
  )
}
