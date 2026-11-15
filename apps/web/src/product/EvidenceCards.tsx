import { useEffect, useState, type ReactNode } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { isPassive, MODALITY_LABEL, OUTCOME_LABEL, type Modality, type VerificationRecord } from '@/lib/product'

/** A measured value and its 95% participant-bootstrap range. */
interface Interval {
  value: number | null
  low: number | null
  high: number | null
}

interface ModelResult {
  id: string
  name: string
  counts: { targets: number; genuine_attempts: number; impostor_attempts: number }
  one_round: { auc: Interval; eer: Interval }
  three_rounds: { auc: Interval; eer: Interval }
  policy: { impostor_accepted: Interval; genuine_accepted: Interval; genuine_fallback: Interval }
}

/** What a passive training script (scripts/aalto.py, scripts/sapimouse.py) wrote. Nothing is computed here. */
interface PassiveModelSummary {
  version: string
  source: string
  window: number
  participants: { total: number }
  models: ModelResult[]
  selected: { id: string; name: string; reason: string }
  limitations: string[]
}

const DATASET: Record<Modality, { name: string; unit: string; credit: ReactNode }> = {
  keys: {
    name: 'Aalto 136M Keystrokes',
    unit: 'keys',
    credit: (
      <>
        Typing data: Dhakal, Feit, Kristensson and Oulasvirta,{' '}
        <a className="underline" href="https://userinterfaces.aalto.fi/136Mkeystrokes/" target="_blank" rel="noreferrer">
          Observations on Typing from 136 Million Keystrokes
        </a>{' '}
        (CHI 2018). Used for non-commercial research with attribution.
      </>
    ),
  },
  pointer: {
    name: 'SapiMouse',
    unit: 'clicks',
    credit: (
      <>
        Pointer data:{' '}
        <a
          className="underline"
          href="https://www.ms.sapientia.ro/~manyi/sapimouse/sapimouse.html"
          target="_blank"
          rel="noreferrer"
        >
          SapiMouse
        </a>{' '}
        (Antal et al., 2021).
      </>
    ),
  },
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

/** "0.84 0.80–0.88" with a bar showing where the range sits between 0 and 1. */
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

function Comparison({ models, selected, sample }: { models: ModelResult[]; selected?: string; sample: string }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[600px]">
        <caption className="sr-only">Held-out results for each candidate model, with 95% ranges</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>AUC, 1 {sample}</TableHead>
            <TableHead>AUC, 3 {sample}s</TableHead>
            <TableHead>Equal error, 1 {sample}</TableHead>
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

function ModelSection({ modality, summary }: { modality: Modality; summary: PassiveModelSummary | null }) {
  const dataset = DATASET[modality]
  if (!summary) {
    return (
      <div className="grid gap-1">
        <h3 className="font-semibold">{MODALITY_LABEL[modality]}</h3>
        <p className="text-muted-foreground">
          No model installed, so this input cannot be checked. The other input, or trusted verification, still works.
        </p>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      <h3 className="font-semibold">{MODALITY_LABEL[modality]}</h3>
      <p className="font-mono text-sm text-muted-foreground">
        {summary.selected.name} · {summary.version} · {summary.participants.total} people from {dataset.name} · one
        sample is {summary.window} {dataset.unit}
      </p>
      <Comparison models={summary.models} selected={summary.selected.id} sample="sample" />
      <p className="text-sm text-muted-foreground">{summary.selected.reason}</p>
      <ul className="grid list-disc gap-1 rounded-lg border border-uncertain/50 bg-uncertain/8 p-4 pl-8 text-sm" role="note">
        {summary.limitations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{dataset.credit}</p>
    </div>
  )
}

/** The passive models and how they did on people they never saw, straight from their eval summaries. */
export function PassiveModelsCard() {
  const [models, setModels] = useState<Record<Modality, PassiveModelSummary | null> | null | undefined>(undefined)
  useEffect(() => {
    api.request<Record<Modality, PassiveModelSummary | null>>('GET', '/passive/models').then(setModels, () => setModels(null))
  }, [])

  return (
    <Card title="Models and measured results">
      {models === undefined && <p className="text-muted-foreground">Loading…</p>}
      {models === null && <p className="text-muted-foreground">Could not load the model summaries.</p>}
      {models && (
        <>
          <p className="text-muted-foreground">
            Both models were trained on public research datasets and tested on people they never saw. Ranges are 95%
            intervals from resampling people. Neither has been calibrated on people using this app yet.
          </p>
          <ModelSection modality="keys" summary={models.keys} />
          <ModelSection modality="pointer" summary={models.pointer} />
        </>
      )}
    </Card>
  )
}

function Similarity({ record }: { record: VerificationRecord }) {
  const d = record.decision
  if (isPassive(d)) {
    const scored = d.parts.filter((p) => p.score !== null)
    if (!scored.length) return <>none</>
    return (
      <span className="grid gap-0.5">
        {scored.map((p) => (
          <span key={p.modality}>
            {p.modality === 'keys' ? 'Typing' : 'Pointer'} {p.score!.toFixed(2)} ({p.reject_at?.toFixed(2)} /{' '}
            {p.accept_at?.toFixed(2)})
          </span>
        ))}
      </span>
    )
  }
  return <>{d.score === null ? 'none' : `${d.score.toFixed(2)} (${d.reject_at?.toFixed(2)} / ${d.accept_at?.toFixed(2)})`}</>
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
                <TableHead>Check</TableHead>
                <TableHead>Similarity (thresholds)</TableHead>
                <TableHead>Released by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-mono text-sm">
                    {new Date(record.at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </TableCell>
                  <TableCell>{OUTCOME_LABEL[record.decision.outcome]}</TableCell>
                  <TableCell className="font-mono text-sm">
                    <Similarity record={record} />
                  </TableCell>
                  <TableCell>
                    {record.resolved_by === 'behavior'
                      ? 'Typing and movement'
                      : record.resolved_by === 'fallback'
                        ? 'Demo authenticator'
                        : 'Not released'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
