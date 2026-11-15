import { recordActivity, type ActivityRecorder } from '@cadence/sdk'
import { ArrowLeft, CircleCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Panel, Shell } from '@/components/Shell'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, explain } from '@/lib/api'
import { ACTION_LABEL, type Modality, type PassiveDecision, type StepUpInfo } from '@/lib/product'
import { CodeForm } from '@/product/CodeForm'

import { SENTENCES, SentenceTest, TargetTest } from './tests'

const TEST_NAME: Record<Modality, string> = { keys: 'Type one sentence', pointer: 'Click 14 circles' }

const WEAKNESS: Record<PassiveDecision['outcome'], number> = {
  INSUFFICIENT_EVIDENCE: 0,
  UNCERTAIN: 1,
  INCONSISTENT: 2,
  CONSISTENT: 3,
}

/**
 * The test to run, with no choice offered: the input the sign-in said least about (so the test
 * fills the gap), among those this person's profile can actually be tested on. When both were
 * equally thin, the one their profile is most likely to pass.
 */
function pickTest(info: StepUpInfo): Modality | null {
  const { recommended, options } = info.recommendation
  if (!recommended) return null
  const rank = (m: Modality) => {
    const part = info.parts.find((p) => p.modality === m)
    return part ? WEAKNESS[part.outcome] : 0
  }
  const available = options.map((o) => o.modality)
  const weakest = Math.min(...available.map(rank))
  const pool = available.filter((m) => rank(m) === weakest)
  return pool.includes(recommended) ? recommended : pool[0]
}

/**
 * Verifying another way, for a check a partner site could not settle. Cadence picks the short
 * test this person's own profile is most likely to pass; a one-time code is always there.
 */
export function VerifyPage({ checkId }: { checkId: string }) {
  const params = new URLSearchParams(window.location.search)
  const returnTo = params.get('return_to')
  const [info, setInfo] = useState<StepUpInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<Modality | null>(null)
  const [result, setResult] = useState<PassiveDecision | null>(null)

  const load = useCallback(async () => {
    try {
      const query = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''
      const loaded = await api.request<StepUpInfo>('GET', `/stepup/${checkId}${query}`)
      setInfo(loaded)
      setTest((t) => t ?? pickTest(loaded))
    } catch (e) {
      setError(explain(e, { check_unknown: 'This verification link is not valid. Start again from the site you were signing in to.' }))
    }
  }, [checkId, returnTo])

  useEffect(() => {
    void load()
  }, [load])

  // Once it is settled, go straight back to the site that asked.
  const backTo = info?.resolved ? info.return_to : null
  useEffect(() => {
    if (!backTo) return
    const t = window.setTimeout(() => window.location.assign(backTo), 900)
    return () => window.clearTimeout(t)
  }, [backTo])

  // Tests while there are some left; the code only when a test can't be used or has run out.
  const failed = result !== null // a test was taken and it did not settle the check: no retry
  const testing = test !== null && info !== null && info.tests_left > 0 && !failed

  return (
    <Shell width="medium">
      <div className="grid gap-6">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!info && !error && (
          <div aria-busy className="grid gap-3">
            <span className="h-8 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="h-4 w-80 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        )}

        {info && (
          <>
            <div className="grid gap-2">
              <h1 className="text-3xl">{info.resolved ? 'Confirmed' : 'Confirm it’s you'}</h1>
              <p className="text-muted-foreground">
                {ACTION_LABEL[info.action] ?? info.action} on {info.site} as {info.username}
              </p>
            </div>

            {info.resolved ? (
              <Done info={info} returnTo={info.return_to} />
            ) : info.expired ? (
              <Panel>
                <p>This check has expired. Go back to {info.site} and try again.</p>
              </Panel>
            ) : (
              <Panel>
                {testing && (
                  <>
                    <h2 className="text-lg">{TEST_NAME[test]}</h2>
                    <QuickTest
                      key={`${test}-${info.tests_left}`}
                      modality={test}
                      checkId={checkId}
                      onResult={(decision) => (setResult(decision), void load())}
                    />
                  </>
                )}

                {!testing && (
                  <>
                    {(failed || test) && (
                      <Alert variant="destructive" role="alert">
                        <AlertDescription>
                          We couldn’t verify you. Please use another form of two-factor authentication to continue.
                        </AlertDescription>
                      </Alert>
                    )}
                    <CodeForm
                      id="stepup"
                      issue={async () => (await api.request<{ demo_code: string }>('POST', `/stepup/${checkId}/start`)).demo_code}
                      verify={async (code) => {
                        await api.request('POST', `/stepup/${checkId}/verify`, { code })
                        await load()
                      }}
                    />
                  </>
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

function QuickTest({ modality, checkId, onResult }: { modality: Modality; checkId: string; onResult: (d: PassiveDecision) => void }) {
  const area = useRef<HTMLDivElement>(null)
  const recorder = useRef<ActivityRecorder | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentence = useRef(Math.floor(Math.random() * SENTENCES.length))

  useEffect(() => {
    if (!area.current) return
    recorder.current = recordActivity({ root: area.current })
    return () => recorder.current?.stop()
  }, [])

  async function submit() {
    if (!recorder.current) return
    setBusy(true)
    setError(null)
    try {
      const out = await api.request<{ decision: PassiveDecision }>('POST', `/stepup/${checkId}/test`, recorder.current.snapshot())
      onResult(out.decision)
    } catch (e) {
      setError(explain(e, { no_tests_left: 'No tests left for this check. Use a code instead.' }))
      setBusy(false)
    }
  }

  // The test submits itself the moment it is complete.
  useEffect(() => {
    if (!ready || busy || error) return
    // A beat, so the last key's release is recorded before the snapshot.
    const t = window.setTimeout(() => void submit(), 200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return (
    <div ref={area} className="grid gap-4">
      {modality === 'keys' ? (
        <SentenceTest sentences={[SENTENCES[sentence.current]]} onSentence={() => setReady(true)} autoFocus />
      ) : (
        <TargetTest total={14} onDone={() => setReady(true)} />
      )}
      {busy && (
        <p className="text-sm text-muted-foreground" role="status">
          Checking…
        </p>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function Done({ info, returnTo }: { info: StepUpInfo; returnTo: string | null }) {
  const how =
    info.resolved_by === 'test'
      ? 'Your test matched your profile.'
      : info.resolved_by === 'fallback'
        ? 'Verified with a code.'
        : 'Your sign-in matched your profile.'
  return (
    <Panel>
      <p className="flex items-center gap-2.5" role="status">
        <CircleCheck className="size-5 shrink-0 text-consistent" aria-hidden="true" />
        {how}
      </p>
      {returnTo ? (
        <Button size="lg" onClick={() => window.location.assign(returnTo)} className="justify-self-start">
          <ArrowLeft aria-hidden="true" />
          Back to {info.site}
        </Button>
      ) : (
        <p className="text-muted-foreground">You can close this tab and return to {info.site}.</p>
      )}
    </Panel>
  )
}
