import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { api, explain } from '@/lib/api'
import { ACTION_LABEL, OUTCOME_LABEL, type Me, type MySites, type Outcome, type SiteCheckRecord } from '@/lib/product'

import { DataControls } from './DataControls'

const PARTNER_URL = import.meta.env.VITE_PARTNER_URL ?? 'http://localhost:5180'

const SETTLED: Record<NonNullable<SiteCheckRecord['resolved_by']>, string> = {
  behavior: 'No extra step',
  test: 'Confirmed with a quick test',
  fallback: 'Confirmed with a code',
}

const OUTCOME_TONE: Record<Outcome, string> = {
  CONSISTENT: 'text-consistent',
  UNCERTAIN: 'text-uncertain',
  INCONSISTENT: 'text-destructive',
  INSUFFICIENT_EVIDENCE: 'text-muted-foreground',
}

const day = (at: number) => new Date(at * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' })
const moment = (at: number) => new Date(at * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

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

  const connected = sites?.sites.length ?? 0
  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <h1 className="text-3xl">Dashboard</h1>
          <p className="text-muted-foreground">
            {connected > 0
              ? `Cadence is checking your sign-ins on ${count(connected, 'site')}.`
              : 'Setup is complete. Connect a site to start checking your sign-ins.'}
          </p>
        </div>
        <a href={PARTNER_URL} className={buttonVariants({ variant: connected > 0 ? 'outline' : 'default', size: 'lg' })}>
          Open Northwind demo
          <ArrowUpRight aria-hidden="true" />
        </a>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card">
        <Stat label="Typing samples" value={me.passive.keys.windows} />
        <Stat label="Click samples" value={me.passive.pointer.windows} />
        <Stat label="Sign-ins learned" value={me.passive.keys.sessions} />
      </dl>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-8">
        <section className="grid gap-3">
          <h2 className="text-lg">Connected sites</h2>
          {!sites ? (
            <Rows loading />
          ) : sites.sites.length === 0 ? (
            <Empty>No sites yet. Turn on Cadence in a site’s security settings to connect it.</Empty>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {sites.sites.map((site) => (
                <li key={site.id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <span className="grid gap-0.5">
                    <span className="font-medium">{site.name}</span>
                    <span className="text-sm text-muted-foreground">
                      Connected {day(site.since)}, {count(site.sign_ins_remembered, 'sign-in')} learned
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => disconnect(site.id)} className="text-muted-foreground">
                    Disconnect
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-3">
          <h2 className="text-lg">Recent checks</h2>
          {!sites ? (
            <Rows loading />
          ) : sites.checks.length === 0 ? (
            <Empty>No checks yet. They appear here each time a connected site asks Cadence about a sign-in.</Empty>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {sites.checks.slice(0, 8).map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <DataControls me={me} onMe={onMe} />

      <footer className="border-t border-border pt-5 text-sm text-muted-foreground">
        <a href="/results" className="underline-offset-4 hover:text-foreground hover:underline">
          Measured results
        </a>
      </footer>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid content-between gap-1 px-4 py-4 sm:px-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-muted-foreground">{children}</p>
}

/** Placeholder rows shaped like the list that replaces them. */
function Rows({ loading }: { loading: true }) {
  return (
    <div aria-busy={loading} className="divide-y divide-border rounded-xl border border-border bg-card">
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-2 px-5 py-4">
          <span className="h-4 w-32 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <span className="h-3.5 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}

function CheckRow({ check }: { check: SiteCheckRecord }) {
  const settled = check.resolved_by ? SETTLED[check.resolved_by] : 'Not confirmed'
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="grid gap-0.5">
        <p className="font-medium">
          {check.site} <span className="font-normal text-muted-foreground">{ACTION_LABEL[check.action] ?? check.action}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {settled}
          {check.learned && ', added to profile'}
        </p>
      </div>
      <div className="grid shrink-0 justify-items-end gap-0.5 text-sm">
        <span className={`font-medium ${OUTCOME_TONE[check.decision.outcome]}`}>{OUTCOME_LABEL[check.decision.outcome]}</span>
        <time className="text-muted-foreground">{moment(check.at)}</time>
      </div>
    </li>
  )
}
