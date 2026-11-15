import { useEffect, useState, type ReactNode } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { MODALITY_LABEL, type Modality } from '@/lib/product'

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
  /** Sign-in typing model only (scripts/aalto.py --login). */
  probe_keys?: [number, number]
  by_keys?: { keys: [number, number]; auc: Interval; eer: Interval }[]
}

type Summaries = Record<Modality, PassiveModelSummary | null> & { login?: PassiveModelSummary | null }

function Limitations({ lines }: { lines: string[] }) {
  return (
    <div className="grid gap-1.5 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Limitations</p>
      <ul className="grid list-disc gap-1 pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

/** The model for the short, partly hidden typing of a sign-in on a partner site. */
function LoginSection({ summary }: { summary: PassiveModelSummary }) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="text-lg">Typing at sign-in</h2>
        <p className="text-sm text-muted-foreground">
          {summary.selected.name}, tested on {summary.participants.total} people from Aalto 136M Keystrokes. One sign-in
          is {summary.probe_keys?.[0]} to {summary.probe_keys?.[1]} keys, with the password part as timing only.
        </p>
      </div>
      <Comparison models={summary.models} selected={summary.selected.id} sample="sign-in" />
      {summary.by_keys && (
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {summary.by_keys.map((band) => (
            <li key={band.keys.join('-')}>
              {band.keys[0]} to {band.keys[1]} keys: AUC {decimal(band.auc.value)}, equal error {percent(band.eer.value)}
            </li>
          ))}
        </ul>
      )}
      <Limitations lines={summary.limitations} />
    </section>
  )
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

const percent = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`)
const decimal = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2))

/** "0.84 0.80 to 0.88" with a bar showing where the range sits between 0 and 1. */
function Ranged({ interval, format }: { interval: Interval; format: (x: number | null) => string }) {
  const { value, low, high } = interval
  return (
    <span className="inline-grid gap-1">
      <span className="whitespace-nowrap">
        <span className="font-mono">{format(value)}</span>{' '}
        {low !== null && high !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            {format(low)} to {format(high)}
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
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
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
            <TableRow key={m.id} className={m.id === selected ? 'bg-muted/40' : undefined}>
              <TableCell className="align-top">
                <span className="font-medium">{m.name}</span>
                {m.id === selected && (
                  <span className="ml-2 rounded-md bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">In use</span>
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
      <section className="grid gap-1">
        <h2 className="text-lg">{MODALITY_LABEL[modality]}</h2>
        <p className="text-muted-foreground">No model is installed, so this input can’t be checked.</p>
      </section>
    )
  }
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="text-lg">{MODALITY_LABEL[modality]}</h2>
        <p className="text-sm text-muted-foreground">
          {summary.selected.name}, tested on {summary.participants.total} people from {dataset.name}. One sample is{' '}
          {summary.window} {dataset.unit}.
        </p>
      </div>
      <Comparison models={summary.models} selected={summary.selected.id} sample="sample" />
      <p className="text-sm text-muted-foreground">{summary.selected.reason}</p>
      <Limitations lines={summary.limitations} />
      <p className="text-sm text-muted-foreground">{dataset.credit}</p>
    </section>
  )
}

/** The passive models and how they did on people they never saw, straight from their eval summaries. */
export function ModelResults() {
  const [models, setModels] = useState<Summaries | null | undefined>(undefined)
  useEffect(() => {
    api.request<Summaries>('GET', '/passive/models').then(setModels, () => setModels(null))
  }, [])

  if (models === undefined) {
    return <div aria-busy className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
  }
  if (models === null) return <p className="text-muted-foreground">The results could not be loaded.</p>
  return (
    <div className="grid gap-12">
      <ModelSection modality="keys" summary={models.keys} />
      {models.login && <LoginSection summary={models.login} />}
      <ModelSection modality="pointer" summary={models.pointer} />
    </div>
  )
}
