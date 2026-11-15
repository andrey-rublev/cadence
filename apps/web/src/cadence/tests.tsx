import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { Label } from '@/components/ui/label'

/** Everyday sentences to copy. Same kind of task as the public typing data the model learned from. */
export const SENTENCES = [
  'The quick brown fox jumps over the lazy dog near the river bank.',
  'Please send the quarterly report to the team before Friday afternoon.',
  'A gentle breeze moved through the open window of the quiet library.',
  'We packed sandwiches, apples and cold water for the long hike up the hill.',
  'Our new office has bright desks, tall plants and a view of the harbour.',
  'Remember to water the garden and lock the back door before you leave.',
  'The museum opens at nine and the guided tour starts twenty minutes later.',
  'She practised the piano every evening until the melody felt natural.',
  'Fresh bread from the corner bakery smells best early in the morning.',
  'Check the map twice, then follow the coastal path towards the lighthouse.',
]

interface SentenceTestProps {
  /** Sentences to copy, in order; wraps around. */
  sentences?: string[]
  start?: number
  onSentence?: (completed: number) => void
  autoFocus?: boolean
}

/**
 * A copy-typing test. The sentence is shown; the person types it below. Mistakes are fine and
 * shown, not blocked: how someone corrects is part of their rhythm. Text never leaves the page.
 */
export function SentenceTest({ sentences = SENTENCES, start = 0, onSentence, autoFocus }: SentenceTestProps) {
  const [index, setIndex] = useState(start)
  const [typed, setTyped] = useState('')
  const [completed, setCompleted] = useState(0)
  const sentence = sentences[index % sentences.length]

  function finish() {
    const done = completed + 1
    setCompleted(done)
    setIndex((i) => i + 1)
    setTyped('')
    onSentence?.(done)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && typed.length >= sentence.length * 0.8) {
      e.preventDefault()
      finish()
    }
  }

  return (
    <div className="grid gap-4">
      <p
        aria-hidden="true"
        className="rounded-lg border border-rule bg-background/60 px-4 py-4 font-mono text-lg leading-relaxed tracking-tight sm:text-xl"
      >
        {[...sentence].map((ch, i) => {
          const state = i >= typed.length ? 'todo' : typed[i] === ch ? 'ok' : 'miss'
          return (
            <span
              key={i}
              className={
                state === 'ok'
                  ? 'text-foreground'
                  : state === 'miss'
                    ? 'rounded-sm bg-destructive/15 text-destructive'
                    : i === typed.length
                      ? 'border-b-2 border-primary text-muted-foreground'
                      : 'text-muted-foreground/70'
              }
            >
              {ch}
            </span>
          )
        })}
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="sentence-input">
          Type the sentence above <span className="sr-only">: {sentence}</span>
        </Label>
        <input
          id="sentence-input"
          value={typed}
          onChange={(e) => {
            const value = e.target.value
            setTyped(value)
            if (value.length >= sentence.length && value.endsWith(sentence.at(-1) ?? '')) finish()
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => e.preventDefault()}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-12 w-full rounded-lg border border-input bg-card px-4 font-mono text-lg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-sm text-muted-foreground">
          Type at your normal pace; mistakes are fine. Press Enter to skip to the next sentence. Pasting is turned off.
        </p>
      </div>
    </div>
  )
}

interface TargetTestProps {
  total: number
  onHit?: (hits: number) => void
  onDone?: () => void
}

interface Target {
  x: number
  y: number
  size: number
}

function nextTarget(previous: Target | null, seed: number): Target {
  // A spread of distances and sizes, so the test sees both long reaches and fine aiming.
  const sizes = [28, 40, 56]
  for (let attempt = 0; ; attempt++) {
    const x = 0.08 + Math.random() * 0.84
    const y = 0.1 + Math.random() * 0.8
    const far = !previous || Math.hypot(x - previous.x, (y - previous.y) * 0.6) > 0.22
    if (far || attempt > 20) return { x, y, size: sizes[seed % sizes.length] }
  }
}

/**
 * The click test: one target at a time, at a fresh spot each time. About 40 seconds for 36
 * targets. Each movement that ends in a click is one stroke for the pointer profile.
 */
export function TargetTest({ total, onHit, onDone }: TargetTestProps) {
  const [hits, setHits] = useState(0)
  const [target, setTarget] = useState<Target>(() => nextTarget(null, 0))
  const button = useRef<HTMLButtonElement>(null)
  const done = hits >= total

  useEffect(() => {
    if (done) onDone?.()
  }, [done, onDone])

  function hit() {
    const count = hits + 1
    setHits(count)
    onHit?.(count)
    if (count < total) setTarget((t) => nextTarget(t, count))
  }

  const ring = useMemo(() => Math.max(0, Math.min(1, hits / total)), [hits, total])

  return (
    <div className="grid gap-3">
      <div
        className="relative aspect-[16/10] w-full touch-none overflow-hidden rounded-xl border border-rule bg-[radial-gradient(circle_at_1px_1px,var(--rule)_1px,transparent_0)] [background-size:24px_24px]"
        aria-label="Click test area"
        role="group"
      >
        {!done ? (
          <button
            ref={button}
            type="button"
            onClick={hit}
            aria-label={`Target ${hits + 1} of ${total}`}
            className="absolute grid -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-2 border-primary bg-primary/10 transition-transform duration-150 hover:bg-primary/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-90 motion-reduce:transition-none"
            style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%`, width: target.size, height: target.size }}
          >
            <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          </button>
        ) : (
          <p className="absolute inset-0 grid place-items-center text-lg font-medium">Click test done.</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">Click each circle as it appears. Accuracy matters more than speed.</span>
        <span className="font-mono text-muted-foreground" aria-live="polite">
          {Math.min(hits, total)} / {total}
        </span>
      </div>
      <span className="h-1.5 overflow-hidden rounded-full bg-rule" aria-hidden="true">
        <span className="block h-full bg-primary transition-[width] duration-200" style={{ width: `${ring * 100}%` }} />
      </span>
    </div>
  )
}
