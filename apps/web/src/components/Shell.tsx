import type { ReactNode } from 'react'

import { Wordmark } from '@/components/Wordmark'

const WIDTH = {
  narrow: 'max-w-md',
  medium: 'max-w-2xl',
  wide: 'max-w-5xl',
}

/** Every Cadence page: a slim header with the mark, then one centred column. */
export function Shell({
  width = 'wide',
  actions,
  children,
}: {
  width?: keyof typeof WIDTH
  /** Shown on the right of the header. */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <Wordmark />
          {actions}
        </div>
      </header>
      <main className={`mx-auto flex w-full flex-1 flex-col px-5 py-10 sm:px-8 sm:py-14 ${WIDTH[width]}`}>{children}</main>
    </div>
  )
}

/** A white surface for one task. Used where the content is a single thing to act on. */
export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`grid gap-5 rounded-xl border border-border bg-card p-6 sm:p-7 ${className}`}>{children}</section>
}

/** A thin progress line. `value` is between 0 and 1. */
export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className="h-1 overflow-hidden rounded-full bg-foreground/10"
    >
      <div
        className="h-full origin-left rounded-full bg-primary transition-transform duration-200 motion-reduce:transition-none"
        style={{ transform: `scaleX(${clamped})` }}
      />
    </div>
  )
}
