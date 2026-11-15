import { recordActivity, sendEvidence, type ActivityRecorder } from '@cadence/sdk'

/** Northwind's own API (backend/partner_demo). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Northwind': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, (data as { detail?: string } | null)?.detail ?? String(response.status))
  return data as T
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password do not match a Northwind account.',
  email_taken: 'That email already has an account. Sign in instead.',
  not_signed_in: 'Your Northwind session ended. Sign in and try again.',
  not_verified: 'Cadence has not confirmed it was you yet. Finish verifying, then try again.',
  pending_unknown: 'This verification request is no longer active. Start again from Northwind.',
  pending_other_browser: 'Finish verifying in the same browser you started in.',
  pending_other_user: 'Finish verifying from the Northwind account that started the request.',
  cadence_not_connected: 'Connect Cadence in Security before deleting your account.',
  deletion_session_changed: 'Your session or Cadence connection changed during verification. Start again from Account.',
  cadence_unreachable: 'Cadence can’t be reached right now. Try again in a moment.',
  'cadence:subject_not_linked': 'Your Cadence connection was removed. Sign in again; you can reconnect under Security.',
  practice_wrong_credentials: 'That email or password is not right for this account. Nothing was sent to Cadence.',
  practice_no_typing: 'Cadence could not be reached, so that one was not saved. Try again.',
  'cadence:practice_closed': 'Cadence is no longer taking practice sign-ins for this connection.',
  'cadence:setup_incomplete': 'Finish setting up Cadence on the Cadence site first, then come back.',
  'cadence:evidence_already_used': 'That typing was already sent. Type it once more.',
}

/** What Cadence said about one practice sign-in. */
export interface Practice {
  accepted?: boolean
  reason?: 'did_not_match' | 'too_little_typing' | string | null
  samples: number
  needed: number
  most: number
  attempts_left: number
  open: boolean
  complete: boolean
  /** Whether new sign-ins are scored against these yet. */
  compared: boolean
}

export function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (MESSAGES[error.code]) return MESSAGES[error.code]
    console.error('Northwind request failed:', error.code)
    return 'Something went wrong. Try again.'
  }
  return 'Northwind can’t be reached right now. Try again in a moment.'
}

// ---------------------------------------------------------------- Cadence, the way a partner uses it

/** Public values only: the site key identifies Northwind; the secret stays on Northwind's server. */
export const CADENCE = {
  siteKey: import.meta.env.VITE_CADENCE_SITE_KEY ?? 'pk_demo_northwind',
  endpoint: import.meta.env.VITE_CADENCE_API ?? 'http://localhost:8000',
}

export type Outcome = 'CONSISTENT' | 'UNCERTAIN' | 'INCONSISTENT' | 'INSUFFICIENT_EVIDENCE'

export interface CheckSummary {
  check_id: string
  outcome: Outcome
  reason: string | null
  resolved_by: 'behavior' | 'test' | 'fallback' | null
  parts: {
    modality: 'keys' | 'pointer'
    outcome: Outcome
    score: number | null
    accept_at: number | null
    reject_at: number | null
    use: 'standard' | 'login' | null
    amount: number | null
    /** Sign-ins: earlier verified sign-ins here that this one was also compared with. */
    earlier_sign_ins?: number
  }[]
}

export interface Me {
  email: string
  cadence: { connected: boolean; since: number | null }
  sign_in_check: CheckSummary | null
}

export type VerificationRequired = { status: 'verify'; pending: string; verify_url: string; check: CheckSummary }

export type Gate<T> =
  | ({
      status: 'signed_in' | 'released'
      check?: CheckSummary | null
      /** Exports: a recent verification covers further exports until then (epoch seconds). */
      trusted_until?: number | null
    } & T)
  | VerificationRequired

/**
 * Hand what this page recorded to Cadence and get an evidence token back. If Cadence cannot be
 * reached the token is null; Northwind's server then gets "not enough evidence" and the person
 * is asked to verify another way, never let through.
 */
export async function evidenceToken(recorder: ActivityRecorder | null): Promise<string | null> {
  if (!recorder) return null
  try {
    return (await sendEvidence(recorder, CADENCE)).token
  } catch {
    return null
  }
}

export { recordActivity }
