import { CadenceApiError, createClient } from '@cadence/sdk'

export const api = createClient('/api')

export interface CollectStatus {
  participant_code: string
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
  unknown_participant_code: 'That code is not valid. Check it against the one you were given, including the last character.',
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
    if (error.code === 'too_soon') {
      const { retry_in_s } = error.detail as { retry_in_s: number }
      const minutes = Math.ceil(retry_in_s / 60)
      return `Sessions on the same device need a 10-minute break between them. Come back in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }
    if (error.code === 'round_rejected') {
      const { reason } = error.detail as { reason: string }
      const known = ROUND_REJECTED[reason.split(':')[0]]
      return `${known ?? 'The recording was incomplete.'} Nothing was saved. Start the round again.`
    }
    return MESSAGES[error.code] ?? `The server refused the request (${error.code}).`
  }
  return 'Could not reach the Cadence server. Check that it is running, then try again.'
}
