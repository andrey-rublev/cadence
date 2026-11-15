/** Types for the product API (backend/cadence/api/auth.py, actions.py, challenges.py). */

export interface Profile {
  sufficient: boolean
  sessions: number
  rounds: number
  sessions_needed: number
  rounds_needed: number
  this_session: { practice_done: boolean; rounds: number; rounds_total: number }
}

export type Modality = 'keys' | 'pointer'

/** Passive learning progress for one kind of input (backend/cadence/passive.py). */
export interface PassiveStatus {
  windows: number
  sessions: number
  windows_needed: number
  sessions_needed: number
  sufficient: boolean
  recent_evidence: number
  model: { version: string; source: string } | null
}

export interface Me {
  username: string
  consent: boolean
  keep_raw: boolean
  trusted: boolean
  profile: Profile
  passive: Record<Modality, PassiveStatus>
  model: { version: string; source: 'volunteer' | 'synthetic' } | null
  retention_days: number
}

export type Outcome = 'CONSISTENT' | 'UNCERTAIN' | 'INCONSISTENT' | 'INSUFFICIENT_EVIDENCE'

export type PassiveReason = 'model_missing' | 'not_enrolled' | 'no_interaction_yet' | 'window_not_measurable' | 'no_evidence'

/** One input's verdict inside a passive check. Score is a similarity, not a probability. */
export interface PassivePart {
  modality: Modality
  outcome: Outcome
  reason: PassiveReason | null
  score: number | null
  reject_at: number | null
  accept_at: number | null
  windows: number
  enrollment_windows: number
  model_version: string | null
}

export interface PassiveDecision {
  outcome: Outcome
  reason: PassiveReason | null
  parts: PassivePart[]
}

export const MODALITY_LABEL: Record<Modality, string> = { keys: 'Typing rhythm', pointer: 'Pointer movement' }

export interface Decision {
  outcome: Outcome
  reason: 'model_missing' | 'not_enrolled' | 'no_interaction_yet' | 'round_not_measurable' | null
  /** Similarity to the enrolled profile. Not a probability of identity. */
  score: number | null
  reject_at: number | null
  accept_at: number | null
  rounds: number
  enrollment_rounds: number
  model_version: string | null
}

export interface Customer {
  id: string
  company: string
  contact: string
  email: string
  phone: string
  plan: string
  seats: number
  since: string
}

export interface VerificationRecord {
  id: string
  action: string
  at: number
  resolved_by: 'behavior' | 'fallback' | null
  decision: Decision | PassiveDecision
}

export const isPassive = (d: Decision | PassiveDecision): d is PassiveDecision => 'parts' in d

export const OUTCOME_LABEL: Record<Outcome, string> = {
  CONSISTENT: 'Matches',
  UNCERTAIN: 'Not sure yet',
  INCONSISTENT: "Doesn't match",
  INSUFFICIENT_EVIDENCE: 'Not enough evidence',
}

export function customersCsv(customers: Customer[]): string {
  const columns: (keyof Customer)[] = ['id', 'company', 'contact', 'email', 'phone', 'plan', 'seats', 'since']
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  return [columns.join(','), ...customers.map((c) => columns.map((k) => cell(c[k])).join(','))].join('\r\n')
}
