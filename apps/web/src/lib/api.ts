import { CadenceApiError, createClient } from '@cadence/sdk'

export const api = createClient('/api')

export interface CollectStatus {
  username: string
  label: string
  warmup_done: boolean
  rounds_done: number
  rounds_total: number
  mode: 'typing' | 'challenge'
  typing_done: number
  typing_total: number
  complete: boolean
}

export interface SubmitResult {
  accepted: boolean
  collect: CollectStatus | null
}

const ROUND_REJECTED: Record<string, string> = {
  target_not_hit: 'The recording did not include a dig on every marked spot.',
  drag_not_completed: 'The recording did not include every find reaching the tray.',
  tracking_not_started: 'The recording ended before the marker started moving.',
  tracking_not_followed: 'The pointer was off the marker for almost all of the six seconds.',
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That username and password do not match an account.',
  not_signed_in: 'You have been signed out. Sign in again to continue.',
  trusted_verification_required: 'This step needs trusted verification first. Verify another way, then try again.',
  enrollment_session_complete: 'This sign-in has recorded all its rounds. Sign out and back in later to record another session.',
  no_rounds_left: 'There are no more rounds for this check. Verify another way to continue.',
  verification_already_resolved: 'This check has already finished. Start the export again.',
  code_incorrect: 'That code does not match. Check the six digits and try again.',
  code_expired: 'That code is no longer valid. Get a new one.',
  grant_expired: 'The approval for this export ran out after two minutes. Start the export again.',
  grant_already_used: 'That approval was already used for one export. Start the export again.',
  verification_required: 'This export needs verification first.',
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
  window_already_used: 'That stretch of activity was already counted.',
  too_many_windows: 'Activity is arriving faster than expected; some was skipped.',
}

/** A plain-language explanation of a failed request, written for the person at the screen. */
export function explain(error: unknown, overrides: Record<string, string> = {}): string {
  if (error instanceof CadenceApiError) {
    if (overrides[error.code]) return overrides[error.code]
    if (error.code === 'round_rejected') {
      const { reason } = error.detail as { reason: string }
      const known = ROUND_REJECTED[reason.split(':')[0]]
      return `${known ?? 'The recording was incomplete.'} Nothing was saved. Start the round again.`
    }
    return MESSAGES[error.code] ?? `The server refused the request (${error.code}).`
  }
  return 'Could not reach the Cadence server. Check that it is running, then try again.'
}
