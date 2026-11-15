import { useEffect, useState, type ReactNode } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { OUTCOME_LABEL, type VerificationRecord } from '@/lib/product'

/** A measured value and its 95% participant-bootstrap range. */
interface Interval {
  value: number | null
  low: number | null
  high: number | null
}

interface ModelResult {
  id: string
  name: string
  counts: {
    targets: number
    people: number
    genuine_attempts: number
    impostor_attempts: number
    genuine_decisions: number
    impostor_decisions: number
  }
  one_round: { auc: Interval; eer: Interval }
  three_rounds: { auc: Interval; eer: Interval }
  policy: {
    impostor_accepted: Interval
    genuine_accepted: Interval
    genuine_rejected: Interval
    genuine_fallback: Interval
  }
  stations: Record<'same' | 'other', { impostor_attempts: number; auc: number | null }>
  auc_gain_over_b0?: Interval
}

/** What `scripts/train.py` wrote for the active model. Nothing here is computed in the browser. */
interface ModelSummary {
  version: string
  source: 'volunteer' | 'synthetic'
  participants: { total: number; with_two_sessions: number }
  rounds: number
  protocol?: { name: string; description: string }
  models?: ModelResult[]
  selected?: { id: string; name: string; reason: string }
  limitations: string[]
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-4 rounded-xl border border-rule bg-card p-6">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  )
}

const percent = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`)
const decimal = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2))

/** "44% (19–71%)" with a bar showing where the range sits between 0 and 1. */
function Ranged({ interval, format }: { interval: Interval; format: (x: number | null) => string }) {
  const { value, low, high } = interval
  return (
    <span className="inline-grid gap-1">
      <span className="whitespace-nowrap">
        <span className="font-mono">{format(value)}</span>{' '}
        {low !== null && high !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            {format(low)}–{format(high)}
          </span>
        )}
      </span>
      {value !== null && low !== null && high !== null && (
        <span className="relative h-1 w-full min-w-16 rounded-full bg-muted" aria-hidden="true">
          <span
            className="absolute inset-y-0 rounded-full bg-foreground/25"
            style={{ left: `${low * 100}%`, width: `${Math.max(high - low, 0.01) * 100}%` }}
          />
          <span className="absolute -top-1 h-3 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${value * 100}%` }} />
        </span>
      )}
    </span>
  )
}

function Outcome({ label, interval, note }: { label: string; interval: Interval; note: string }) {
  return (
    <div className="grid content-start gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl">
        <Ranged interval={interval} format={percent} />
      </dd>
      <dd className="text-sm text-muted-foreground">{note}</dd>
    </div>
  )
}

function Comparison({ models, selected }: { models: ModelResult[]; selected?: string }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[640px]">
        <caption className="sr-only">Held-out results for each candidate model, with 95% ranges</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>AUC, 1 round</TableHead>
            <TableHead>AUC, 3 rounds</TableHead>
            <TableHead>Equal error, 1 round</TableHead>
            <TableHead>Impostors let through</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((m) => (
            <TableRow key={m.id} className={m.id === selected ? 'bg-muted/60' : undefined}>
              <TableCell className="align-top">
                <span className="font-semibold">{m.name}</span>
                {m.id === selected && (
                  <span className="ml-2 rounded-sm border border-foreground/40 px-1.5 py-0.5 text-xs">in use</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <Ranged interval={m.one_round.auc} format={decimal} />
              </TableCell>
              <TableCell className="align-top">
                <Ranged interval={m.three_rounds.auc} format={decimal} />
              </TableCell>
              <TableCell className="align-top">
                <Ranged interval={m.one_round.eer} format={percent} />
              </TableCell>
              <TableCell className="align-top">
                <Ranged interval={m.policy.impostor_accepted} format={percent} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ModelCard() {
  const [summary, setSummary] = useState<ModelSummary | null | undefined>(undefined)
  useEffect(() => {
    api.request<ModelSummary | null>('GET', '/model').then(setSummary, () => setSummary(null))
  }, [])

  if (summary === undefined) return <Card title="Model and measured results">Loading…</Card>
  if (summary === null) {
    return (
      <Card title="Model and measured results">
        <p className="text-muted-foreground">
          No verification model is installed. Until one is trained on volunteer data, every movement check
          answers “Not enough evidence” and the export needs trusted verification.
        </p>
      </Card>
    )
  }

  const { participants } = summary
  const current = summary.models?.find((m) => m.id === summary.selected?.id)
  return (
    <Card title="Model and measured results">
      <p className="font-mono text-sm text-muted-foreground">
        {summary.selected?.name ?? 'Model'} · {summary.version} · {participants.total} people,{' '}
        {participants.with_two_sessions} with two sessions · {summary.rounds} rounds
      </p>

      {current ? (
        <>
          <div className="grid gap-3">
            <h3 className="font-semibold">What a check decided for people it had never seen</h3>
            <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <Outcome
                label="Impostors let through"
                interval={current.policy.impostor_accepted}
                note={`of ${current.counts.impostor_decisions} impostor checks`}
              />
              <Outcome
                label="Owners let through"
                interval={current.policy.genuine_accepted}
                note={`of ${current.counts.genuine_decisions} owner checks, each up to three rounds`}
              />
              <Outcome
                label="Owners sent to the demo authenticator"
                interval={current.policy.genuine_fallback}
                note="still uncertain after three rounds"
              />
              <Outcome
                label="Owners held as a mismatch"
                interval={current.policy.genuine_rejected}
                note="the export waits for trusted verification"
              />
            </dl>
            <p className="text-sm text-muted-foreground">
              Ranges are 95% intervals from resampling people. With this few people they are wide; read the range,
              not the single number.
            </p>
          </div>

          {summary.models && summary.models.length > 1 && (
            <div className="grid gap-3">
              <h3 className="font-semibold">Baseline against the learned models</h3>
              <Comparison models={summary.models} selected={summary.selected?.id} />
              <p className="text-sm text-muted-foreground">{summary.selected?.reason}</p>
            </div>
          )}

          <div className="grid gap-1">
            <h3 className="font-semibold">Same laptop or not</h3>
            <p className="text-sm text-muted-foreground">
              Impostors on the owner's own laptop: AUC {decimal(current.stations.same.auc)} over{' '}
              {current.stations.same.impostor_attempts} attempts. On another laptop: AUC{' '}
              {decimal(current.stations.other.auc)} over {current.stations.other.impostor_attempts}. A gap here means part
              of what separates people is their device, so the same-laptop figure is the honest one.
            </p>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">
          This model was trained before held-out comparisons existed. Retrain it with <code>scripts/train.py</code>.
        </p>
      )}

      {summary.limitations.length > 0 && (
        <ul className="grid list-disc gap-1.5 rounded-lg border border-uncertain/50 bg-uncertain/8 p-4 pl-8 text-sm" role="note">
          {summary.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {summary.protocol && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">How this was measured</summary>
          <p className="mt-2">{summary.protocol.description}</p>
        </details>
      )}
    </Card>
  )
}

export function HistoryCard({ refreshKey }: { refreshKey: number }) {
  const [records, setRecords] = useState<VerificationRecord[]>([])
  useEffect(() => {
    api
      .request<{ verifications: VerificationRecord[] }>('GET', '/verifications')
      .then((r) => setRecords(r.verifications))
  }, [refreshKey])

  return (
    <Card title="Recent checks on this account">
      {records.length === 0 ? (
        <p className="text-muted-foreground">No protected action has been attempted yet. Try an export.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Movement check</TableHead>
                <TableHead>Similarity</TableHead>
                <TableHead>Rounds</TableHead>
                <TableHead>Released by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => {
                const d = record.decision
                return (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-sm">
                      {new Date(record.at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </TableCell>
                    <TableCell>{OUTCOME_LABEL[d.outcome]}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {d.score === null
                        ? 'none'
                        : `${d.score.toFixed(2)} (${d.reject_at?.toFixed(2)} / ${d.accept_at?.toFixed(2)})`}
                    </TableCell>
                    <TableCell className="tabular-nums">{d.rounds}</TableCell>
                    <TableCell>
                      {record.resolved_by === 'behavior'
                        ? 'Movement'
                        : record.resolved_by === 'fallback'
                          ? 'Demo authenticator'
                          : 'Not released'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
