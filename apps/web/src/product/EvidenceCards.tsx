import { useEffect, useState, type ReactNode } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { OUTCOME_LABEL, type VerificationRecord } from '@/lib/product'

/** What `scripts/train.py` wrote for the active model. Nothing here is computed in the browser. */
interface ModelSummary {
  version: string
  model: string
  source: 'volunteer' | 'synthetic'
  participants: Record<string, number>
  rounds: Record<string, number>
  thresholds?: { reject_at: number; accept_at: number; target_error: number }
  test?: {
    participants: number
    genuine_attempts: number
    impostor_attempts: number
    reliable: boolean
    far_at_accept?: number
    frr_at_reject?: number
    genuine_uncertain?: number
    impostor_uncertain?: number
    eer?: number
    auc?: number
  }
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

const percent = (rate: number | undefined) => (rate === undefined ? 'n/a' : `${(rate * 100).toFixed(1)}%`)

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-2xl">{value}</dd>
      <dd className="text-sm text-muted-foreground">{note}</dd>
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

  const test = summary.test
  const people = Object.entries(summary.participants)
    .map(([split, n]) => `${n} ${split}`)
    .join(', ')
  return (
    <Card title="Model and measured results">
      <p className="font-mono text-sm text-muted-foreground">
        {summary.model} · {summary.version} · participants: {people}
      </p>

      {summary.limitations.length > 0 && (
        <ul className="grid gap-1.5 rounded-lg border border-uncertain/50 bg-uncertain/8 p-4" role="note">
          {summary.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {test && test.far_at_accept !== undefined ? (
        <>
          <dl className={`grid gap-5 sm:grid-cols-2 ${test.reliable && summary.source === 'volunteer' ? '' : 'opacity-70'}`}>
            <Metric
              label="Impostors accepted (false acceptance)"
              value={percent(test.far_at_accept)}
              note={`of ${test.impostor_attempts} impostor attempts by ${test.participants} test participants`}
            />
            <Metric
              label="Owners rejected (false rejection)"
              value={percent(test.frr_at_reject)}
              note={`of ${test.genuine_attempts} genuine attempts in a later session`}
            />
            <Metric
              label="Owners sent to another round"
              value={percent(test.genuine_uncertain)}
              note="genuine attempts landing between the thresholds"
            />
            <Metric label="Equal error rate" value={percent(test.eer)} note={`AUC ${test.auc?.toFixed(3) ?? 'n/a'}`} />
          </dl>
          <p className="text-sm text-muted-foreground">
            One 20-second round per attempt. Test participants were never used to fit the model or choose its
            thresholds. Sessions were recorded on the same day, which flatters these numbers.
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">No test results were produced for this model.</p>
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
