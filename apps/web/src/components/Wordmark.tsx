/** The Cadence mark: a pointer trace settling onto a target. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5 font-heading text-xl font-bold tracking-tight [font-stretch:88%]">
      <svg viewBox="0 0 34 20" className="h-5 w-auto" aria-hidden="true">
        <path
          d="M1 15c5 0 5-11 10-11s4 9 8 9 3-4 6-4"
          className="fill-none stroke-foreground"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="29" cy="9" r="4" className="fill-primary" />
      </svg>
      Cadence
    </span>
  )
}
