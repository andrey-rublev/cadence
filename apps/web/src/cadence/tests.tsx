import { Check } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { Progress } from '@/components/Shell'

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
  /** Called each time a sentence is finished, with how many have been. */
  onSentence?: (completed: number) => void
  /** Called with how many characters of the current sentence are typed. */
  onTyping?: (typed: number) => void
  autoFocus?: boolean
}

/**
 * A copy-typing test. The person types straight onto the sentence: typed letters turn to ink,
 * a caret marks the next one, and the sentence moves on by itself when its end is reached.
 * Mistakes are fine and shown, not blocked: how someone corrects is part of their rhythm.
 * Text never leaves the page.
 */
export function SentenceTest({ sentences = SENTENCES, start = 0, onSentence, onTyping, autoFocus }: SentenceTestProps) {
  const [index, setIndex] = useState(start)
  const [typed, setTyped] = useState('')
  const [completed, setCompleted] = useState(0)
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sentence = sentences[index % sentences.length]

  function type(value: string) {
    if (value.length < sentence.length) {
      setTyped(value)
      onTyping?.(value.length)
      return
    }
    const done = completed + 1
    setCompleted(done)
    setIndex((i) => i + 1)
    setTyped('')
    onTyping?.(0)
    onSentence?.(done)
  }

  // Focus that arrived before the first render (autoFocus) fires no event React can hear.
  useEffect(() => setFocused(document.activeElement === input.current), [])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Someone who dropped a few letters can still move on near the end.
    if (e.key === 'Enter' && typed.length >= sentence.length * 0.8) {
      e.preventDefault()
      type(sentence)
    }
  }

  return (
    <div className="relative rounded-xl border border-border bg-card transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
      <p
        key={index}
        aria-hidden="true"
        className={`min-h-[6.75rem] animate-in px-5 py-5 font-mono text-lg leading-[1.7] whitespace-pre-wrap duration-200 fade-in motion-reduce:animate-none sm:min-h-[7.5rem] sm:px-6 sm:text-xl ${focused ? '' : 'opacity-40'} transition-opacity`}
      >
        {[...sentence].map((ch, i) => {
          const state = i < typed.length ? (typed[i] === ch ? 'ok' : 'miss') : i === typed.length ? 'next' : 'todo'
          return (
            <span
              key={i}
              className={
                state === 'ok'
                  ? 'text-foreground'
                  : state === 'miss'
                    ? 'rounded-[3px] bg-destructive/10 text-destructive'
                    : state === 'next' && focused
                      ? 'relative text-muted-foreground before:absolute before:inset-y-[0.2em] before:-left-px before:w-0.5 before:animate-caret before:rounded-full before:bg-primary motion-reduce:before:animate-none'
                      : 'text-muted-foreground'
              }
            >
              {ch}
            </span>
          )
        })}
      </p>
      {!focused && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm font-medium" aria-hidden="true">
          Click here to keep typing
        </p>
      )}
      <label htmlFor="sentence-input" className="sr-only">
        Type this sentence: {sentence}
      </label>
      {/* The real field sits invisibly over the sentence, so a click anywhere on it focuses. */}
      <input
        ref={input}
        id="sentence-input"
        value={typed}
        onChange={(e) => type(e.target.value)}
        onKeyDown={onKeyDown}
        onSelect={(e) => e.currentTarget.setSelectionRange(typed.length, typed.length)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={(e) => e.preventDefault()}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="absolute inset-0 size-full cursor-text rounded-xl text-base opacity-0"
      />
    </div>
  )
}

interface TargetTestProps {
  /** How many targets to show. Leave out to keep them coming until the test is unmounted. */
  total?: number
  /** Progress from 0 to 1 for the line under the area, when it is not simply hits out of total. */
  progress?: number
  /** Text beside the progress line, when it is not simply hits out of total. */
  status?: string
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
 * The click test: one target at a time, at a fresh spot each time. Each movement that ends in
 * a click is one stroke for the pointer profile.
 */
export function TargetTest({ total, progress, status, onHit, onDone }: TargetTestProps) {
  const [hits, setHits] = useState(0)
  const [target, setTarget] = useState<Target>(() => nextTarget(null, 0))
  /** Where the last few targets were hit: a ring spreads out from each and is then dropped. */
  const [rings, setRings] = useState<(Target & { id: number })[]>([])
  const ringId = useRef(0)
  const done = total !== undefined && hits >= total

  useEffect(() => {
    if (done) onDone?.()
  }, [done, onDone])

  function hit() {
    const count = hits + 1
    setHits(count)
    onHit?.(count)
    setRings((r) => [...r.slice(-3), { ...target, id: ringId.current++ }])
    if (total === undefined || count < total) setTarget((t) => nextTarget(t, count))
  }

  const place = (t: Target) => ({ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: t.size, height: t.size })

  return (
    <div className="grid gap-3">
      <div
        className="relative aspect-[16/10] w-full touch-none overflow-hidden rounded-xl border border-border bg-card bg-[radial-gradient(circle,var(--border)_1px,transparent_1.5px)] [background-size:22px_22px] select-none"
        aria-label="Click test area"
        role="group"
      >
        {rings.map((ring) => (
          <span
            key={ring.id}
            onAnimationEnd={() => setRings((r) => r.filter((other) => other.id !== ring.id))}
            className="pointer-events-none absolute -translate-1/2 animate-dug rounded-full border-2 border-primary motion-reduce:hidden"
            style={place(ring)}
            aria-hidden="true"
          />
        ))}
        {!done ? (
          <div key={hits} className="absolute -translate-1/2" style={place(target)}>
            {hits === 0 && (
              <span
                className="pointer-events-none absolute inset-0 animate-beckon rounded-full bg-primary motion-reduce:hidden"
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              onClick={hit}
              aria-label={total === undefined ? `Target ${hits + 1}` : `Target ${hits + 1} of ${total}`}
              className="relative grid size-full animate-in cursor-pointer place-items-center rounded-full border-2 border-primary bg-accent transition-[scale,background-color] duration-100 zoom-in-75 fade-in hover:bg-[color-mix(in_oklch,var(--accent),var(--primary)_14%)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-90 motion-reduce:animate-none motion-reduce:transition-none"
            >
              <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className="absolute inset-0 flex animate-in items-center justify-center gap-2 font-medium duration-200 fade-in motion-reduce:animate-none">
            <Check className="size-4" aria-hidden="true" />
            Done
          </p>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Progress value={progress ?? (total ? hits / total : 0)} label="Click test progress" />
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {status ?? `${Math.min(hits, total ?? hits)} / ${total}`}
        </span>
      </div>
    </div>
  )
}
