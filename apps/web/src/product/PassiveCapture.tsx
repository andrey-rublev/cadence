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
  /** Complete windows awaiting confirmation from the server. */
  saving: Record<Modality, number>
  /** What the server did with the last window sent. */
  last: LastSample | null
}

export interface LastSample {
  modality: Modality
  purpose: 'enroll' | 'evidence' | 'rejected' | 'unconfirmed'
  /** Why a rejected sample was not counted (server error code). */
  code?: string
}

const PassiveContext = createContext<PassiveState>({
  running: false,
  paused: false,
  setPaused: () => undefined,
  progress: { strokes: 0, keys: 0 },
  saving: { pointer: 0, keys: 0 },
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
  const [saving, setSaving] = useState<Record<Modality, number>>({ pointer: 0, keys: 0 })
  const [last, setLast] = useState<PassiveState['last']>(null)
  const running = Boolean(me?.consent) && !paused
  const username = me?.username

  useEffect(() => {
    if (!running || !username || !root.current) return
    let active = true

    function applyProgress({ passive, setup, learning }: Pick<Me, 'passive' | 'setup' | 'learning'>) {
      setMe((current) =>
        current && current.username === username ? { ...current, passive, setup, learning } : current,
      )
    }

    async function send(window: PassiveWindow) {
      const { modality } = window
      setSaving((previous) => ({ ...previous, [modality]: previous[modality] + 1 }))

      try {
        const saved = await api.request<{
          purpose: 'enroll' | 'evidence'
          modality: Modality
          passive: Record<Modality, PassiveStatus>
          setup: SetupStatus
          learning: boolean
        }>('POST', '/passive', window)
        if (!active) return
        applyProgress(saved)
        setLast({ modality: saved.modality, purpose: saved.purpose })
      } catch (error) {
        if (!active) return
        if (!(error instanceof CadenceApiError) || error.status >= 500) {
          // A lost response may follow a committed sample. Read back progress instead of
          // resending the recording or asking the person to repeat a sample already saved.
          const current = await api.request<Me | null>('GET', '/me').catch(() => null)
          if (!active) return
          if (current && current.username === username) applyProgress(current)
          setLast({ modality, purpose: 'unconfirmed' })
        } else {
          setLast({ modality, purpose: 'rejected', code: error.code })
        }
      } finally {
        if (active) {
          setSaving((previous) => ({ ...previous, [modality]: previous[modality] - 1 }))
        }
      }
    }
    const capture = startPassive({
      root: root.current,
      onWindow: send,
      onProgress: setProgress,
      strokes: STROKES_PER_WINDOW,
      keys: KEYS_PER_WINDOW,
    })
    return () => {
      active = false
      capture.stop()
      setProgress({ strokes: 0, keys: 0 })
      setSaving({ pointer: 0, keys: 0 })
      setLast(null)
    }
  }, [running, root, setMe, username])

  return <PassiveContext value={{ running, paused, setPaused, progress, saving, last }}>{children}</PassiveContext>
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
