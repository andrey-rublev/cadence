import { CadenceApiError, startPassive, type PassiveProgress, type PassiveWindow } from '@cadence/sdk'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  last: LastSample | null
}

export interface LastSample {
  modality: Modality
  /** enroll: added to the profile; evidence: kept for checks in this sign-in; rejected: not counted. */
  purpose: 'enroll' | 'evidence' | 'rejected'
  /** Why a rejected sample was not counted (server error code). */
  code?: string
}

const NOT_COUNTED: Record<string, string> = {
  too_little_movement: 'too few clear clicks in it',
  too_little_typing: 'too few keys in it',
  window_already_used: 'it was already counted',
  too_many_windows: 'activity arrived faster than expected',
  client_clock_ahead_of_server: 'its timing did not match the server clock',
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
          // A thin or duplicate window is not counted; capture carries on, and the UI says so.
          (error: unknown) =>
            setLast({
              modality: window.modality,
              purpose: 'rejected',
              code: error instanceof CadenceApiError ? error.code : undefined,
            }),
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

export const PRACTICE_PROMPT =
  'Describe your last working day: what you did first, who you talked to, and what is still on your list.'

/** A place to type in your own words. The text stays in the page; only key timing and zones are sent. */
export function PracticeBox({ id, label, rows = 4 }: { id: string; label: string; rows?: number }) {
  const [text, setText] = useState('')
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={rows}
        placeholder={PRACTICE_PROMPT}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="text-base"
      />
      <p className="text-xs text-muted-foreground">
        What you type stays in this page. Cadence records when keys go down and up and which part of the keyboard they
        are on, never the characters.
      </p>
    </div>
  )
}

/** What happened to the last sample, in words: a full meter resets, and this says where it went. */
export function lastSampleText(last: LastSample): string {
  const kind = last.modality === 'keys' ? 'typing' : 'pointer'
  if (last.purpose === 'enroll') return `Last ${kind} sample: added to your profile.`
  if (last.purpose === 'evidence') return `Last ${kind} sample: saved for checks in this sign-in.`
  const why = (last.code && NOT_COUNTED[last.code]) ?? 'the server turned it down'
  return `Last ${kind} sample: not counted (${why}). Keep going; the next one may count.`
}

/** Live count towards the next sample of each kind, so "keep working" has a visible end. */
export function NextSample() {
  const { running, progress, last } = usePassive()
  if (!running) return <p className="text-sm text-muted-foreground">Capture is paused. Resume it in the header.</p>
  return (
    <div className="grid gap-3 rounded-lg border border-rule p-4">
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2" aria-live="off">
        <Meter label="Keys towards the next typing sample" value={progress.keys} total={KEYS_PER_WINDOW} />
        <Meter label="Clicks towards the next pointer sample" value={progress.strokes} total={STROKES_PER_WINDOW} />
      </div>
      <p
        role="status"
        className={`text-sm ${last?.purpose === 'rejected' ? 'text-muted-foreground' : last ? 'text-consistent' : 'text-muted-foreground'}`}
      >
        {last ? lastSampleText(last) : 'A full meter sends a sample and starts again from zero.'}
      </p>
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
