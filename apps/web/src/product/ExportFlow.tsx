import type { ChallengeResult, IssuedChallenge } from '@cadence/sdk'
import { CircleDashed, Download, ShieldAlert, ShieldCheck, Hourglass } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { RoundRunner } from '@/challenge/RoundRunner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, explain } from '@/lib/api'
import { customersCsv, type Customer, type Decision, type Me } from '@/lib/product'

import { DecisionMeter } from './DecisionMeter'
import { FallbackPanel } from './FallbackPanel'

type Step =
  | { name: 'checking' }
  | { name: 'ready' } // a round is needed; waiting for the person to start it
  | { name: 'round'; challenge: IssuedChallenge }
  | { name: 'scoring' }
  | { name: 'result' } // decision shown; action depends on its outcome
  | { name: 'fallback' }
  | { name: 'exported'; customers: Customer[]; basis: 'behavior' | 'fallback' }

interface Opened {
  verification_id: string
  decision: Decision
}

interface RoundResult {
  decision: Decision
  grant: string | null
  rounds_left: number
}

interface ExportFlowProps {
  me: Me
  onClose: () => void
  onMe: (me: Me) => void
  onSetUpProfile: () => void
}

/** Outcome banner. Icon, wording and colour all differ, so no state relies on colour alone. */
function Outcome({ tone, icon, title, children }: { tone: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className={`grid gap-1.5 rounded-lg border p-4 ${tone}`} role="status">
      <p className="flex items-center gap-2 font-heading text-xl font-bold">
        {icon}
        {title}
      </p>
      <div className="text-base text-foreground/85">{children}</div>
    </div>
  )
}

const ICON = 'size-5 shrink-0'

/**
 * The protected "Export customer records" action. Every decision shown here was made by
 * the server; this component only reports it and offers the next step. Closing or
 * tampering with it cannot produce an export, which needs a server-side grant.
 */
export function ExportFlow({ me, onClose, onMe, onSetUpProfile }: ExportFlowProps) {
  const [step, setStep] = useState<Step>({ name: 'checking' })
  const [verificationId, setVerificationId] = useState('')
  const [decision, setDecision] = useState<Decision | null>(null)
  const [roundsLeft, setRoundsLeft] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const opening = useRef(false)
  useEffect(() => {
    // Opening a check writes a record on the server, so do it once per dialog even when
    // React re-runs effects in development.
    if (opening.current) return
    opening.current = true
    api
      .request<Opened>('POST', '/actions/export_customers/authorize')
      .then((opened) => {
        setVerificationId(opened.verification_id)
        setDecision(opened.decision)
        setStep(opened.decision.reason === 'no_interaction_yet' ? { name: 'ready' } : { name: 'result' })
      })
      .catch((e) => (setError(explain(e)), setStep({ name: 'result' })))
  }, [])

  async function runExport(grant: string) {
    const exported = await api.request<{ customers: Customer[]; basis: 'behavior' | 'fallback' }>('POST', '/export', {
      grant,
    })
    setStep({ name: 'exported', ...exported })
  }

  async function startRound() {
    setBusy(true)
    setError(null)
    try {
      const challenge = await api.request<IssuedChallenge>('POST', '/challenges', {
        purpose: 'verify',
        verification_id: verificationId,
      })
      setStep({ name: 'round', challenge })
    } catch (e) {
      setError(explain(e))
    }
    setBusy(false)
  }

  async function finishRound(challenge: IssuedChallenge, result: ChallengeResult) {
    setStep({ name: 'scoring' })
    try {
      const scored = await api.submitChallenge<RoundResult>(challenge.id, result)
      setDecision(scored.decision)
      setRoundsLeft(scored.rounds_left)
      if (scored.grant) await runExport(scored.grant)
      else setStep({ name: 'result' })
    } catch (e) {
      setError(explain(e))
      setStep({ name: 'ready' })
    }
  }

  function download(customers: Customer[]) {
    const url = URL.createObjectURL(new Blob([customersCsv(customers)], { type: 'text/csv' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: 'customers-fictional.csv' })
    link.click()
    URL.revokeObjectURL(url)
  }

  const fallbackButton = (
    <Button variant="outline" size="lg" onClick={() => setStep({ name: 'fallback' })} className="h-11 px-5 text-base">
      Verify another way
    </Button>
  )
  const inRound = step.name === 'round'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto p-6 sm:max-w-[856px]">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-bold">Export customer records</DialogTitle>
          <DialogDescription className="text-base">
            Exporting is a sensitive action, so Cadence checks it before the server releases the file.
          </DialogDescription>
        </DialogHeader>

        {step.name === 'checking' && <p className="text-muted-foreground">Checking what this export needs…</p>}

        {(step.name === 'ready' || inRound || step.name === 'scoring') && (
          <div className="grid gap-4">
            <RoundRunner
              challenge={inRound ? step.challenge : null}
              idleText={
                step.name === 'scoring'
                  ? 'Comparing that round with your profile…'
                  : 'A 20-second pointing task checks that the movement matches this account’s owner.'
              }
              onComplete={(result) => inRound && finishRound(step.challenge, result)}
            >
              {step.name === 'ready' && (
                <div className="grid max-w-sm justify-items-center gap-4 rounded-xl border border-rule bg-card/95 p-6 text-center shadow-sm">
                  <p>Dig eight spots, carry three finds to the tray, then follow the marker. Move the way you normally would.</p>
                  <Button size="lg" onClick={startRound} disabled={busy} className="h-12 px-6 text-base">
                    {busy ? 'One moment…' : 'Start the check'}
                  </Button>
                </div>
              )}
            </RoundRunner>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <p>Using a different mouse, an injury or assistive technology can make this task unfair.</p>
              <Button variant="link" onClick={() => setStep({ name: 'fallback' })} className="h-auto p-0 text-sm underline">
                I can’t do this task. Verify another way
              </Button>
            </div>
          </div>
        )}

        {step.name === 'result' && decision?.outcome === 'INSUFFICIENT_EVIDENCE' && (
          <div className="grid gap-4">
            <Outcome
              tone="border-dashed border-input bg-muted/60"
              icon={<CircleDashed className={ICON} aria-hidden="true" />}
              title="Not enough evidence"
            >
              {decision.reason === 'not_enrolled' && (
                <>
                  This account has no finished movement profile yet ({me.profile.rounds} of {me.profile.rounds_needed}{' '}
                  rounds across {me.profile.sessions} of {me.profile.sessions_needed} sign-ins), so there is nothing to
                  compare with. This is not a mismatch.
                </>
              )}
              {decision.reason === 'model_missing' &&
                'No verification model is installed on this server, so movement cannot be checked. This is not a mismatch.'}
              {decision.reason === 'round_not_measurable' &&
                'That round could not be measured well enough to compare. This is not a mismatch.'}
            </Outcome>
            <div className="flex flex-wrap gap-2">
              {fallbackButton}
              {decision.reason === 'not_enrolled' && (
                <Button variant="ghost" size="lg" onClick={onSetUpProfile} className="h-11 px-5 text-base">
                  Set up the movement profile
                </Button>
              )}
            </div>
          </div>
        )}

        {step.name === 'result' && decision?.outcome === 'UNCERTAIN' && (
          <div className="grid gap-4">
            <Outcome
              tone="border-uncertain/50 bg-uncertain/8"
              icon={<Hourglass className={`${ICON} text-uncertain`} aria-hidden="true" />}
              title="Not sure yet"
            >
              The result sits between the two thresholds.{' '}
              {roundsLeft > 0 ? 'Another round usually settles it.' : 'There are no rounds left for this check.'}
            </Outcome>
            <DecisionMeter decision={decision} />
            <div className="flex flex-wrap gap-2">
              {roundsLeft > 0 && (
                <Button size="lg" onClick={() => setStep({ name: 'ready' })} className="h-11 px-5 text-base">
                  Do another round
                </Button>
              )}
              {fallbackButton}
            </div>
          </div>
        )}

        {step.name === 'result' && decision?.outcome === 'INCONSISTENT' && (
          <div className="grid gap-4">
            <Outcome
              tone="border-destructive/50 bg-destructive/8"
              icon={<ShieldAlert className={`${ICON} text-destructive`} aria-hidden="true" />}
              title="Movement doesn’t match. Export on hold"
            >
              That round did not look like the profile recorded for this account. It can happen with a different
              mouse, a sore hand or a different person. The account is not locked; this export just needs stronger
              verification.
            </Outcome>
            <DecisionMeter decision={decision} />
            <div className="flex flex-wrap gap-2">{fallbackButton}</div>
          </div>
        )}

        {step.name === 'fallback' && (
          <FallbackPanel
            verificationId={verificationId}
            onVerified={async ({ grant, me: updated }) => {
              onMe(updated)
              if (grant) await runExport(grant).catch((e) => (setError(explain(e)), setStep({ name: 'result' })))
            }}
          />
        )}

        {step.name === 'exported' && (
          <div className="grid gap-4">
            <Outcome
              tone="border-consistent/50 bg-consistent/8"
              icon={<ShieldCheck className={`${ICON} text-consistent`} aria-hidden="true" />}
              title="Export released"
            >
              {step.basis === 'behavior'
                ? 'The movement in that check was consistent with this account’s profile, so the export continued under your existing sign-in.'
                : 'Released after trusted verification with the demo authenticator.'}{' '}
              {step.customers.length} fictional records.
            </Outcome>
            {step.basis === 'behavior' && decision && <DecisionMeter decision={decision} />}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => download(step.customers)} className="h-11 px-5 text-base">
                <Download aria-hidden="true" />
                Download CSV
              </Button>
              <Button variant="ghost" size="lg" onClick={onClose} className="h-11 px-5 text-base">
                Done
              </Button>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  )
}
