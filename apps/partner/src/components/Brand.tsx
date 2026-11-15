import { ShieldCheck } from 'lucide-react'

import type { CheckSummary } from '@/lib/api'

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill={inverted ? '#ffffff14' : '#0f3b3a'} />
        <path d="M9 23V9l14 14V9" fill="none" stroke="#f0b450" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-heading text-lg font-semibold tracking-tight">
        Northwind <span className="font-normal opacity-70">CRM</span>
      </span>
    </span>
  )
}

/** "Protected by Cadence" as a partner would show it. */
export function CadenceBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      <ShieldCheck className="size-4" aria-hidden="true" />
      Protected by Cadence
    </span>
  )
}

const OUTCOME: Record<CheckSummary['outcome'], string> = {
  CONSISTENT: 'looked like you',
  UNCERTAIN: 'was a close call',
  INCONSISTENT: 'did not look like you',
  INSUFFICIENT_EVIDENCE: 'had too little typing or clicking to check',
}

const RESOLVED: Record<NonNullable<CheckSummary['resolved_by']>, string> = {
  behavior: 'No extra step was needed.',
  test: 'You confirmed it with a quick test.',
  fallback: 'You confirmed it with the authenticator.',
}

/** What Cadence told Northwind about a check: outcome and how sure, never the raw data. */
export function Verdict({ check, what }: { check: CheckSummary; what: string }) {
  const scored = check.parts.filter((p) => p.score !== null)
  return (
    <p className="text-sm">
      <span className="font-medium">Cadence:</span> this {what} {OUTCOME[check.outcome]}
      {scored.length > 0 && (
        <span className="text-muted-foreground">
          {' '}
          (
          {scored
            .map(
              (p) =>
                `${p.modality === 'keys' ? `typing, ${p.amount} keys` : `clicks, ${p.amount}`}: ${p.score?.toFixed(2)} vs pass mark ${p.accept_at?.toFixed(2)}`,
            )
            .join('; ')}
          )
        </span>
      )}
      . {check.resolved_by ? RESOLVED[check.resolved_by] : ''}
    </p>
  )
}
