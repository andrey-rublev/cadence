import { startPassive, type PassiveWindow } from '@cadence/sdk'
import { ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, explain, type CollectStatus } from '@/lib/api'
import { KEYS_PER_WINDOW, Meter } from '@/product/PassiveCapture'

/** Everyday prompts that invite a few sentences without asking for anything personal. */
const PROMPTS = [
  'Describe how you got here today, step by step.',
  'What would you cook for friends if you had a free evening?',
  'Explain the rules of a game or sport you know well.',
  'Describe the room you are in to someone who has never seen it.',
  'What is a small habit that makes your day better, and why?',
  'Plan a perfect weekend in a city you would like to visit.',
  'Describe a tool or app you use every day and what you would change about it.',
  'Tell the story of a film or book you liked, without spoiling the ending.',
]

interface TypingSessionProps {
  status: CollectStatus
  onStatus: (status: CollectStatus) => void
  onExit: () => void
}

/**
 * A collection session with no game: the volunteer answers prompts in their own words while
 * Cadence records key timing. The text itself never leaves this page.
 */
export function TypingSession({ status, onStatus, onExit }: TypingSessionProps) {
  const area = useRef<HTMLDivElement>(null)
  const [prompt, setPrompt] = useState(() => (status.typing_done + status.label.charCodeAt(0)) % PROMPTS.length)
  const [text, setText] = useState('')
  const [keys, setKeys] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!area.current) return
    const send = (window: PassiveWindow) => {
      if (window.modality !== 'keys') return
      api.request<{ collect: CollectStatus }>('POST', '/collect/passive', window).then(
        (saved) => {
          setError(null)
          onStatus(saved.collect)
        },
        (e) => setError(explain(e, { too_little_typing: 'That stretch had too little typing to count. Keep going.' })),
      )
    }
    const capture = startPassive({
      root: area.current,
      onWindow: send,
      onProgress: (p) => setKeys(p.keys),
      keys: KEYS_PER_WINDOW,
      strokes: 10_000, // pointer windows are not collected here
    })
    return () => capture.stop()
  }, [onStatus])

  function nextPrompt() {
    setPrompt((p) => (p + 1) % PROMPTS.length)
    setText('')
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="font-mono text-sm text-muted-foreground">
            {status.username} · session {status.label}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">Type a few answers</h1>
        </div>
        <div className="grid w-full max-w-xs gap-3">
          <Meter label="Samples recorded" value={status.typing_done} total={status.typing_total} />
          <Meter label="Keys towards the next sample" value={keys} total={KEYS_PER_WINDOW} />
        </div>
      </div>

      <div ref={area} className="grid gap-4 rounded-xl border border-rule bg-card p-6 sm:p-8">
        <div className="grid gap-2">
          <Label htmlFor="answer" className="text-xl font-semibold">
            {PROMPTS[prompt]}
          </Label>
          <p className="text-sm text-muted-foreground">
            Type the way you normally would, mistakes and all. A few sentences per prompt, then move on.
          </p>
        </div>
        <Textarea
          id="answer"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          className="text-lg"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm text-muted-foreground">
            What you type is never sent or saved. Cadence records when each key goes down and up and which part of the
            keyboard it is on. Please still avoid anything private.
          </p>
          <Button variant="outline" onClick={nextPrompt} className="h-11 px-4 text-base">
            Another prompt
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="link" onClick={onExit} className="h-auto p-0 text-sm text-muted-foreground underline">
          I can't do this, or I want to stop
        </Button>
      </div>
    </div>
  )
}
