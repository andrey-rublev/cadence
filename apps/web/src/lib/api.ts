import { CadenceApiError, createClient } from '@cadence/sdk'

export const api = createClient('/api')

export interface CollectStatus {
  username: string
  label: string
  warmup_done: boolean
  rounds_done: number
  rounds_total: number
  complete: boolean
}

export interface SubmitResult {
  accepted: boolean
  collect: CollectStatus | null
}

const ROUND_REJECTED: Record<string, string> = {
  target_not_hit: 'The recording did not include a dig on every marked spot.',
  drag_not_completed: 'The recording did not include every nugget reaching the crate.',
  tracking_not_started: 'The recording ended before the mole started moving.',
  tracking_not_followed: 'The pointer was off the mole for almost all of the six seconds.',
}

const MESSAGES: Record<string, string> = {
  consent_required: 'Tick the consent box to take part.',
  invalid_username: 'Use 3 to 24 letters or numbers for the username. Dots, dashes and underscores are fine; spaces are not.',
  username_taken: 'Sessions are already recorded under that username on this laptop. Pick a different one, or choose "Yes" above if it was you.',
  unknown_username: 'No session has been recorded under that username on this laptop. Check the spelling.',
  no_active_session: 'This session has ended. Start again from the first screen.',
  session_complete: 'This session is already complete.',
  challenge_expired: 'That round ran past its two-minute limit, so it was not recorded. Start it again.',
  challenge_already_used: 'That round was already submitted. Start a new one.',
  challenge_rate_limited: 'Too many rounds were started in a short time. Wait a few minutes, then continue.',
  payload_too_large: 'That round produced more data than can be sent. Start it again.',
}

/** A plain-language explanation of a failed request, written for the person at the screen. */
export function explain(error: unknown): string {
  if (error instanceof CadenceApiError) {
    if (error.code === 'round_rejected') {
      const { reason } = error.detail as { reason: string }
      const known = ROUND_REJECTED[reason.split(':')[0]]
      return `${known ?? 'The recording was incomplete.'} Nothing was saved. Start the round again.`
    }
    return MESSAGES[error.code] ?? `The server refused the request (${error.code}).`
  }
  return 'Could not reach the Cadence server. Check that it is running, then try again.'
}
