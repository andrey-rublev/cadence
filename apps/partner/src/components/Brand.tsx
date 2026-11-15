import { ShieldAlert, ShieldCheck } from 'lucide-react'

import type { CheckSummary } from '@/lib/api'

export function Logo({ inverted = false, compact = false }: { inverted?: boolean; compact?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2.5" aria-label="Northwind CRM">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill={inverted ? '#ffffff14' : '#0f3b3a'} />
        <path d="M9 23V9l14 14V9" fill="none" stroke="#f0b450" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`text-base font-semibold tracking-tight whitespace-nowrap ${compact ? 'hidden sm:inline' : ''}`}>
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

const OUTCOME: Record<CheckSummary['outcome'], (what: string) => string> = {
  CONSISTENT: (what) => `Cadence verified this ${what}.`,
  UNCERTAIN: (what) => `Cadence wasn’t sure about this ${what}.`,
  INCONSISTENT: (what) => `This ${what} didn’t look like you.`,
  INSUFFICIENT_EVIDENCE: (what) => `There was too little typing to check this ${what}.`,
}

const RESOLVED: Record<NonNullable<CheckSummary['resolved_by']>, string> = {
  behavior: 'No extra step was needed.',
  test: 'You confirmed it with a quick test.',
  fallback: 'You confirmed it with a code.',
}

/** What Cadence told Northwind about a check: the outcome and how it was settled. */
export function Verdict({ check, what }: { check: CheckSummary; what: string }) {
  const Icon = check.outcome === 'CONSISTENT' ? ShieldCheck : ShieldAlert
  return (
    <p className="flex items-start gap-2.5">
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${check.outcome === 'CONSISTENT' ? 'text-good' : 'text-unsure'}`}
        aria-hidden="true"
      />
      <span>
        <span className="font-medium">{OUTCOME[check.outcome](what)}</span>{' '}
        {check.resolved_by && <span className="text-muted-foreground">{RESOLVED[check.resolved_by]}</span>}
      </span>
    </p>
  )
}
