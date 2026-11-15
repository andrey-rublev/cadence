import { startPassive, type PassiveProgress, type PassiveWindow } from '@cadence/sdk'
import { Pause, Play } from 'lucide-react'
import {
  createContext,
  use,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { Me, Modality, PassiveStatus } from '@/lib/product'

export const STROKES_PER_WINDOW = 12
export const KEYS_PER_WINDOW = 50

interface PassiveState {
  /** Capture is running: consent given, signed in, not paused. */
  running: boolean
  paused: boolean
  setPaused: (paused: boolean) => void
  /** Input collected towards the next window of each kind. */
  progress: PassiveProgress
  /** What the server did with the last window sent. */
  last: { modality: Modality; purpose: 'enroll' | 'evidence' } | null
}

const PassiveContext = createContext<PassiveState>({
  running: false,
  paused: false,
  setPaused: () => undefined,
  progress: { strokes: 0, keys: 0 },
  last: null,
})

export const usePassive = () => use(PassiveContext)

interface ProviderProps {
  me: Me | null | undefined
  setMe: Dispatch<SetStateAction<Me | null | undefined>>
  /** Only input inside this element is observed. */
  root: RefObject<HTMLElement | null>
  children: ReactNode
}

/**
 * Runs passive capture while a consenting user works in the app. No task, no game: windows
 * of ordinary pointer movement and key timing go to the server, which decides whether they
 * build the profile (trusted session) or count as evidence for this session.
 */
export function PassiveProvider({ me, setMe, root, children }: ProviderProps) {
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState<PassiveProgress>({ strokes: 0, keys: 0 })
  const [last, setLast] = useState<PassiveState['last']>(null)
  const running = Boolean(me?.consent) && !paused

  useEffect(() => {
    if (!running || !root.current) return
    const send = (window: PassiveWindow) =>
      api
        .request<{ purpose: 'enroll' | 'evidence'; modality: Modality; passive: Record<Modality, PassiveStatus> }>(
          'POST',
          '/passive',
          window,
        )
        .then(
          (saved) => {
            setLast({ modality: saved.modality, purpose: saved.purpose })
            setMe((current) => (current ? { ...current, passive: saved.passive } : current))
          },
          // A thin or duplicate window is simply not counted; capture carries on.
          () => undefined,
        )
    const capture = startPassive({
      root: root.current,
      onWindow: send,
      onProgress: setProgress,
      strokes: STROKES_PER_WINDOW,
      keys: KEYS_PER_WINDOW,
    })
    return () => {
      capture.stop()
      setProgress({ strokes: 0, keys: 0 })
    }
  }, [running, root, setMe])

  return <PassiveContext value={{ running, paused, setPaused, progress, last }}>{children}</PassiveContext>
}

export function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="grid gap-1">
      <p className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {Math.min(value, total)} / {total}
        </span>
      </p>
      <span className="h-1.5 overflow-hidden rounded-full bg-rule" aria-hidden="true">
        <span
          className="block h-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `${Math.min(1, value / total) * 100}%` }}
        />
      </span>
    </div>
  )
}

/** Live count towards the next sample of each kind, so "keep working" has a visible end. */
export function NextSample() {
  const { running, progress } = usePassive()
  if (!running) return <p className="text-sm text-muted-foreground">Capture is paused. Resume it in the header.</p>
  return (
    <div className="grid gap-x-8 gap-y-3 rounded-lg border border-rule p-4 sm:grid-cols-2" aria-live="off">
      <Meter label="Keys towards the next typing sample" value={progress.keys} total={KEYS_PER_WINDOW} />
      <Meter label="Clicks towards the next pointer sample" value={progress.strokes} total={STROKES_PER_WINDOW} />
    </div>
  )
}

/** Always-visible statement of whether capture is on, with a way to pause it. */
export function CaptureIndicator({ me, onOpenProfile }: { me: Me; onOpenProfile: () => void }) {
  const { running, paused, setPaused, progress } = usePassive()
  if (!me.consent) {
    return (
      <Button variant="ghost" onClick={onOpenProfile} className="h-10 gap-2 px-3 text-sm text-muted-foreground">
        <span className="size-2 rounded-full border border-muted-foreground" aria-hidden="true" />
        Capture off
      </Button>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-full border border-rule bg-card py-1 pr-1 pl-3 text-sm">
      <span className="relative flex size-2" aria-hidden="true">
        {running && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 motion-reduce:hidden" />
        )}
        <span className={`relative inline-flex size-2 rounded-full ${running ? 'bg-primary' : 'bg-muted-foreground'}`} />
      </span>
      <span>
        {running ? (me.trusted ? 'Learning your rhythm' : 'Checking quietly') : 'Paused'}
        <span className="sr-only">
          {running && `, ${progress.keys} of ${KEYS_PER_WINDOW} keys and ${progress.strokes} of ${STROKES_PER_WINDOW} clicks towards the next sample`}
        </span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? 'Resume capture' : 'Pause capture'}
        className="size-8 rounded-full p-0"
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      </Button>
    </div>
  )
}
