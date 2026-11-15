import { CircleDashed, Download, Hourglass, RotateCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, explain } from '@/lib/api'
import {
  customersCsv,
  MODALITY_LABEL,
  type Customer,
  type Me,
  type PassiveDecision,
  type PassivePart,
} from '@/lib/product'

import { DecisionMeter } from './DecisionMeter'
import { FallbackPanel } from './FallbackPanel'
import { NextSample } from './PassiveCapture'

type Step =
  | { name: 'checking' }
  | { name: 'result' }
  | { name: 'fallback' }
  | { name: 'exported'; customers: Customer[]; basis: 'behavior' | 'fallback' }

interface Opened {
  verification_id: string
  decision: PassiveDecision
  grant: string | null
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

function partNote(part: PassivePart, me: Me): string {
  const status = me.passive[part.modality]
  switch (part.reason) {
    case 'not_enrolled':
      return `No profile yet: ${status.windows} of ${status.windows_needed} samples from ${status.sessions} of ${status.sessions_needed} sign-ins.`
    case 'no_interaction_yet':
      return 'Nothing recent from this sign-in yet.'
    case 'model_missing':
      return 'No model installed for this input.'
    case 'window_not_measurable':
      return 'Recent activity could not be measured well enough.'
    default:
      return ''
  }
}

function Parts({ decision, me }: { decision: PassiveDecision; me: Me }) {
  return (
    <div className="grid gap-5">
      {decision.parts.map((part) =>
        part.score !== null ? (
          <DecisionMeter
            key={part.modality}
            label={MODALITY_LABEL[part.modality]}
            score={part.score}
            rejectAt={part.reject_at}
            acceptAt={part.accept_at}
            basis={`averaged over ${part.windows} recent ${part.windows === 1 ? 'sample' : 'samples'}`}
          />
        ) : (
          <p key={part.modality} className="text-sm">
            <span className="font-medium">{MODALITY_LABEL[part.modality]}:</span>{' '}
            <span className="text-muted-foreground">{partNote(part, me)}</span>
          </p>
        ),
      )}
    </div>
  )
}

/**
 * The protected "Export customer records" action, decided from ordinary use: no task, no
 * game. Every decision is the server's; this dialog reports it and offers the next step.
 * Closing or tampering with it cannot produce an export, which needs a server-side grant.
 */
export function ExportFlow({ me, onClose, onMe, onSetUpProfile }: ExportFlowProps) {
  const [step, setStep] = useState<Step>({ name: 'checking' })
  const [opened, setOpened] = useState<Opened | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runExport = useCallback(async (grant: string) => {
    const exported = await api.request<{ customers: Customer[]; basis: 'behavior' | 'fallback' }>('POST', '/export', {
      grant,
    })
    setStep({ name: 'exported', ...exported })
  }, [])

  const check = useCallback(async () => {
    setStep({ name: 'checking' })
    setError(null)
    try {
      const result = await api.request<Opened>('POST', '/actions/export_customers/authorize')
      setOpened(result)
      if (result.grant) await runExport(result.grant)
      else setStep({ name: 'result' })
    } catch (e) {
      setError(explain(e))
      setStep({ name: 'result' })
    }
  }, [runExport])

  // Opening a check writes a record on the server, so do it once per dialog even when
  // React re-runs effects in development.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void check()
  }, [check])

  function download(customers: Customer[]) {
    const url = URL.createObjectURL(new Blob([customersCsv(customers)], { type: 'text/csv' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: 'customers-fictional.csv' })
    link.click()
    URL.revokeObjectURL(url)
  }

  const decision = opened?.decision
  const actions = (primary?: ReactNode) => (
    <div className="flex flex-wrap gap-2">
      {primary}
      <Button
        variant={primary ? 'outline' : 'default'}
        size="lg"
        onClick={() => setStep({ name: 'fallback' })}
        className="h-11 px-5 text-base"
      >
        Verify another way
      </Button>
    </div>
  )
  const checkAgain = (
    <Button size="lg" onClick={check} className="h-11 px-5 text-base">
      <RotateCw aria-hidden="true" />
      Check again
    </Button>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto p-6 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-bold">Export customer records</DialogTitle>
          <DialogDescription className="text-base">
            Exporting is sensitive, so Cadence compares how you have been typing and moving in this sign-in with your
            profile before the server releases the file. There is nothing to play.
          </DialogDescription>
        </DialogHeader>

        {step.name === 'checking' && <p className="text-muted-foreground">Comparing recent activity with your profile…</p>}

        {step.name === 'result' && decision?.outcome === 'INSUFFICIENT_EVIDENCE' && (
          <div className="grid gap-4">
            <Outcome
              tone="border-dashed border-input bg-muted/60"
              icon={<CircleDashed className={ICON} aria-hidden="true" />}
              title="Not enough evidence yet"
            >
              {decision.reason === 'no_interaction_yet' &&
                'There is not enough recent activity from this sign-in to compare. Keep working for a minute (search, write a note, click around), then check again. This is not a mismatch.'}
              {decision.reason === 'not_enrolled' &&
                'This account has no finished behaviour profile yet, so there is nothing to compare with. This is not a mismatch.'}
              {decision.reason === 'model_missing' &&
                'No verification model is installed on this server, so behaviour cannot be checked. This is not a mismatch.'}
              {(decision.reason === 'window_not_measurable' || decision.reason === 'no_evidence') &&
                'Recent activity could not be measured well enough to compare. This is not a mismatch.'}
            </Outcome>
            {decision.reason === 'no_interaction_yet' && <NextSample />}
            <Parts decision={decision} me={me} />
            {actions(
              decision.reason === 'no_interaction_yet' ? (
                checkAgain
              ) : decision.reason === 'not_enrolled' ? (
                <Button size="lg" onClick={onSetUpProfile} className="h-11 px-5 text-base">
                  Set up the profile
                </Button>
              ) : undefined,
            )}
          </div>
        )}

        {step.name === 'result' && decision?.outcome === 'UNCERTAIN' && (
          <div className="grid gap-4">
            <Outcome
              tone="border-uncertain/50 bg-uncertain/8"
              icon={<Hourglass className={`${ICON} text-uncertain`} aria-hidden="true" />}
              title="Not sure yet"
            >
              Recent activity sits between the two thresholds. A little more typing or clicking usually settles it.
            </Outcome>
            <NextSample />
            <Parts decision={decision} me={me} />
            {actions(checkAgain)}
          </div>
        )}

        {step.name === 'result' && decision?.outcome === 'INCONSISTENT' && (
          <div className="grid gap-4">
            <Outcome
              tone="border-destructive/50 bg-destructive/8"
              icon={<ShieldAlert className={`${ICON} text-destructive`} aria-hidden="true" />}
              title="Doesn’t match this account. Export on hold"
            >
              Recent typing or pointer movement did not look like the profile recorded for this account. It can
              happen with a different keyboard or mouse, an injury, or a different person. The account is not locked;
              this export just needs stronger verification.
            </Outcome>
            <Parts decision={decision} me={me} />
            {actions()}
          </div>
        )}

        {step.name === 'fallback' && (
          <FallbackPanel
            verificationId={opened?.verification_id}
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
                ? 'Recent activity was consistent with this account’s profile, so the export continued under your existing sign-in without any extra step.'
                : 'Released after trusted verification with the demo authenticator.'}{' '}
              {step.customers.length} fictional records.
            </Outcome>
            {step.basis === 'behavior' && decision && <Parts decision={decision} me={me} />}
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
