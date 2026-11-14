import { useEffect, useState } from 'react'

import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { api, type CollectStatus } from '@/lib/api'

import { ConsentForm } from './ConsentForm'
import { SessionScreen } from './SessionScreen'

type Stage = 'loading' | 'intro' | 'session' | 'stopped'

const RECORDED = [
  'Where your pointer is and when you click, inside the dig site',
  'The username you choose, and whether you use a mouse or a trackpad',
]
const NOT_RECORDED = [
  'Your real name, email or contact details',
  'Anything else you type, or anything outside this page',
]

function Intro({ onStarted }: { onStarted: (status: CollectStatus) => void }) {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <div className="grid gap-8">
        <div className="grid gap-4">
          <p className="font-mono text-sm text-muted-foreground">MadHacks 2026 · research prototype</p>
          <h1 className="text-5xl font-extrabold sm:text-6xl">
            Is the way you move a pointer recognisably yours?
          </h1>
          <p className="max-w-prose text-lg text-muted-foreground">
            We're testing whether a short pointing task can tell an account's owner from someone else
            at the same keyboard. That takes real people. The task is a small digging game: one
            practice round and six 20-second rounds, about three minutes in all. A second session,
            ideally after a break, makes your data count twice.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-lg font-bold">Recorded</h2>
            <ul className="grid gap-2">
              {RECORDED.map((item) => (
                <li key={item} className="border-l-2 border-primary pl-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-lg font-bold">Never recorded</h2>
            <ul className="grid gap-2">
              {NOT_RECORDED.map((item) => (
                <li key={item} className="border-l-2 border-rule pl-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="max-w-prose text-sm text-muted-foreground">
          You pick a username, so your recordings are not tied to your name. They are used only to
          train and test this hackathon project and are deleted within 30 days. To have yours
          deleted sooner, tell anyone on the team your username.
        </p>
      </div>

      <ConsentForm onStarted={onStarted} />
    </div>
  )
}

function Complete({ status, onExit }: { status: CollectStatus; onExit: () => void }) {
  const first = status.label === 'A'
  return (
    <div className="mx-auto grid max-w-xl justify-items-start gap-6 py-10">
      <p className="font-mono text-sm text-muted-foreground">
        {status.username} · session {status.label} recorded
      </p>
      <h1 className="text-5xl font-extrabold">{first ? 'One session down.' : 'That is everything. Thank you.'}</h1>
      <p className="text-lg text-muted-foreground">
        {first ? (
          <>
            A second three-minute session lets us compare you with yourself, which is the whole test.
            Come back whenever suits you, choose "Yes" on the first screen and enter{' '}
            <span className="font-mono text-foreground">{status.username}</span> again.
          </>
        ) : (
          'If you can spare three more minutes on a different laptop or a different mouse, a session there under the same username helps us test device changes.'
        )}
      </p>
      <Button size="lg" onClick={onExit} className="h-12 px-6 text-base">
        Finish and hand back the laptop
      </Button>
    </div>
  )
}

function Stopped({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="mx-auto grid max-w-xl justify-items-start gap-6 py-10">
      <h1 className="text-5xl font-extrabold">Stopped. Nothing more is needed.</h1>
      <p className="text-lg text-muted-foreground">
        Rounds you already finished stay recorded under your username. If you would like them deleted,
        or the task did not work with how you use a computer, tell anyone on the team.
      </p>
      <Button size="lg" variant="outline" onClick={onRestart} className="h-12 px-6 text-base">
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
    <div className="mx-auto grid min-h-svh w-full max-w-6xl grid-rows-[auto_1fr] gap-8 px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex items-center justify-between">
        <Wordmark />
        <span className="font-mono text-sm text-muted-foreground">collection mode</span>
      </header>
      <main>
        {stage === 'intro' && (
          <Intro
            onStarted={(started) => {
              setStatus(started)
              setStage('session')
            }}
          />
        )}
        {stage === 'session' && status && !status.complete && (
          <div className="mx-auto max-w-[800px]">
            <SessionScreen status={status} onStatus={setStatus} onExit={() => exit('stopped')} />
          </div>
        )}
        {stage === 'session' && status?.complete && <Complete status={status} onExit={() => exit('intro')} />}
        {stage === 'stopped' && <Stopped onRestart={() => setStage('intro')} />}
      </main>
    </div>
  )
}
