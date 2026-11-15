import { useEffect, useState } from 'react'

import { Shell } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { api, type CollectStatus } from '@/lib/api'

import { ConsentForm } from './ConsentForm'
import { SessionScreen } from './SessionScreen'
import { TypingSession } from './TypingSession'

type Stage = 'loading' | 'intro' | 'session' | 'stopped'

function Complete({ status, onExit }: { status: CollectStatus; onExit: () => void }) {
  const first = status.label === 'A'
  if (status.mode === 'typing') {
    return (
      <div className="mx-auto grid w-full max-w-xl justify-items-start gap-5">
        <h1 className="text-3xl">{first ? 'One session down.' : 'Recorded. Thank you.'}</h1>
        <p className="text-muted-foreground">
          Typing changes from day to day, and that change is exactly what we need to measure. If you can, come back on
          a <strong className="text-foreground">different day</strong>, choose "Yes" on the first screen and enter{' '}
          <span className="font-medium text-foreground">{status.username}</span> again. Another laptop or keyboard helps
          too.
        </p>
        <Button size="lg" onClick={onExit}>
          Finish and hand back the laptop
        </Button>
      </div>
    )
  }
  return (
    <div className="mx-auto grid w-full max-w-xl justify-items-start gap-5">
      <h1 className="text-3xl">{first ? 'One session down.' : 'That is everything. Thank you.'}</h1>
      <p className="text-muted-foreground">
        {first ? (
          <>
            A second three-minute session lets us compare you with yourself, which is the whole test.
            Come back whenever suits you, choose "Yes" on the first screen and enter{' '}
            <span className="font-medium text-foreground">{status.username}</span> again.
          </>
        ) : (
          'If you can spare three more minutes on a different laptop or a different mouse, a session there under the same username helps us test device changes.'
        )}
      </p>
      <Button size="lg" onClick={onExit}>
        Finish and hand back the laptop
      </Button>
    </div>
  )
}

function Stopped({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-xl justify-items-start gap-5">
      <h1 className="text-3xl">Stopped. Nothing more is needed.</h1>
      <p className="text-muted-foreground">
        Rounds you already finished stay recorded under your username. If you would like them deleted,
        or the task did not work with how you use a computer, tell anyone on the team.
      </p>
      <Button size="lg" variant="outline" onClick={onRestart}>
        Back to the start
      </Button>
    </div>
  )
}

export function CollectPage() {
  const [stage, setStage] = useState<Stage>('loading')
  const [status, setStatus] = useState<CollectStatus | null>(null)

  useEffect(() => {
    // Resume a session that is still open in this browser (for example after a reload).
    api
      .request<CollectStatus | null>('GET', '/collect/status')
      .then((current) => {
        setStatus(current)
        setStage(current ? 'session' : 'intro')
      })
      .catch(() => setStage('intro'))
  }, [])

  async function exit(next: Stage) {
    await api.request('POST', '/collect/finish').catch(() => undefined)
    setStatus(null)
    setStage(next)
  }

  return (
    <Shell actions={<span className="text-sm text-muted-foreground">Data collection</span>}>
      <>
        {stage === 'intro' && (
          <div className="mx-auto w-full max-w-xl">
            <ConsentForm
              onStarted={(started) => {
                setStatus(started)
                setStage('session')
              }}
            />
          </div>
        )}
        {stage === 'session' && status && !status.complete && (
          <div className="mx-auto w-full max-w-[800px]">
            {status.mode === 'typing' ? (
              <TypingSession status={status} onStatus={setStatus} onExit={() => exit('stopped')} />
            ) : (
              <SessionScreen status={status} onStatus={setStatus} onExit={() => exit('stopped')} />
            )}
          </div>
        )}
        {stage === 'session' && status?.complete && <Complete status={status} onExit={() => exit('intro')} />}
        {stage === 'stopped' && <Stopped onRestart={() => setStage('intro')} />}
      </>
    </Shell>
  )
}
