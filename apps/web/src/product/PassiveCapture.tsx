import { CadenceApiError, startPassive, type PassiveProgress, type PassiveWindow } from '@cadence/sdk'
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

import { Progress } from '@/components/Shell'
import { api } from '@/lib/api'
import type { Me, Modality, PassiveStatus, SetupStatus } from '@/lib/product'

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
        .request<{
          purpose: 'enroll' | 'evidence'
          modality: Modality
          passive: Record<Modality, PassiveStatus>
          setup: SetupStatus
          learning: boolean
        }>('POST', '/passive', window)
        .then(
          (saved) => {
            setLast({ modality: saved.modality, purpose: saved.purpose })
            setMe((current) =>
              current ? { ...current, passive: saved.passive, setup: saved.setup, learning: saved.learning } : current,
            )
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
    <div className="grid gap-1.5">
      <p className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {Math.min(value, total)} / {total}
        </span>
      </p>
      <Progress value={value / total} label={label} />
    </div>
  )
}
