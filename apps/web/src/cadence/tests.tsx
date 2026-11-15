import { Check, ClipboardList } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { DigSpot, Hole, SurveyGround } from '@/challenge/DigArt'
import { SHEET } from '@/challenge/sheet'
import { Progress } from '@/components/Shell'

/** Excavation field notes written as ordinary sentences to copy. */
export const SENTENCES = [
  'We found a small piece of pottery beside the old wall near the river.',
  'The crew set down their shovels and marked the corners of the trench.',
  'A thin layer of pale sand appeared just beneath the dark garden soil.',
  'We packed brushes, string and clean trays before walking to the dig site.',
  'The old coin caught the light as she brushed the last grains of dirt away.',
  'Leave the shovel by the gate and bring the wooden crate back to camp.',
  'The first layer held shells, but the next one was packed with smooth stones.',
  'We worked slowly around the fossil until its edge was free of clay.',
  'Rain softened the ground enough to uncover the stone steps in the morning.',
  'Check the sketch against the trench before filling in the field notes.',
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
    <div className="overflow-hidden rounded-xl border border-contour-deep bg-ground-light transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
      <div className="flex items-center gap-2 border-b border-contour bg-ground px-5 py-2.5 text-sm font-medium text-pit sm:px-6">
        <ClipboardList className="size-4" aria-hidden="true" />
        Excavation field notes
      </div>
      <div className="relative">
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
          className="absolute inset-0 size-full cursor-text text-base opacity-0"
        />
      </div>
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
  const [pits, setPits] = useState<(Target & { id: number })[]>([])
  const done = total !== undefined && hits >= total

  useEffect(() => {
    if (done) onDone?.()
  }, [done, onDone])

  function hit() {
    const count = hits + 1
    setHits(count)
    onHit?.(count)
    setPits((previous) => [...previous.slice(-3), { ...target, id: count }])
    if (total === undefined || count < total) setTarget((t) => nextTarget(t, count))
  }

  const place = (t: Target) => ({ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: t.size, height: t.size })

  return (
    <div className="grid gap-3">
      <div
        className="relative aspect-[16/10] w-full touch-none overflow-hidden rounded-xl border border-contour-deep bg-linear-to-b from-ground-light to-ground select-none"
        aria-label="Excavation area"
        role="group"
      >
        <svg viewBox={`0 0 ${SHEET.w} ${SHEET.h}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          <SurveyGround />
        </svg>
        {pits.map((pit) => (
          <svg
            key={pit.id}
            viewBox="-24 -24 48 48"
            className="pointer-events-none absolute -translate-1/2 overflow-visible"
            style={place(pit)}
            aria-hidden="true"
          >
            <Hole r={24} />
          </svg>
        ))}
        {!done ? (
          <div key={hits} className="absolute -translate-1/2" style={place(target)}>
            {hits === 0 && (
              <span
                className="pointer-events-none absolute inset-0 animate-beckon rounded-full border-2 border-brass-deep motion-reduce:hidden"
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              onClick={hit}
              aria-label={total === undefined ? `Dig spot ${hits + 1}` : `Dig spot ${hits + 1} of ${total}`}
              className="relative block size-full cursor-pointer rounded-full transition-[filter] duration-100 hover:brightness-125 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
            >
              <svg viewBox="-24 -24 48 48" className="pointer-events-none size-full" aria-hidden="true">
                <DigSpot r={24} />
              </svg>
            </button>
          </div>
        ) : (
          <p className="absolute inset-0 m-auto flex size-fit animate-in items-center gap-2 rounded-full border border-contour-deep bg-ground-light px-4 py-2 font-medium text-pit duration-200 fade-in motion-reduce:animate-none">
            <Check className="size-4" aria-hidden="true" />
            Dig complete
          </p>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Progress value={progress ?? (total ? hits / total : 0)} label="Excavation progress" />
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {status ?? (total === undefined ? `${hits} dug` : `${hits} / ${total} dug`)}
        </span>
      </div>
    </div>
  )
}
