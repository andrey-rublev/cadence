import type { Decision } from '@/lib/product'

/**
 * Where a similarity score sits against the two decision thresholds.
 * Deliberately shows no percentage: the score is not a probability of identity.
 */
export function DecisionMeter({ decision }: { decision: Decision }) {
  const { score, reject_at: reject, accept_at: accept } = decision
  if (score === null || reject === null || accept === null) return null

  const low = Math.min(score, reject)
  const high = Math.max(score, accept)
  const pad = Math.max((high - low) * 0.2, 0.08)
  const [from, to] = [low - pad, high + pad]
  const at = (value: number) => `${((value - from) / (to - from)) * 100}%`
  const zones = [
    { label: "Doesn't match", start: from, end: reject, tone: 'bg-destructive/25' },
    { label: 'Not sure', start: reject, end: accept, tone: 'bg-uncertain/25' },
    { label: 'Matches', start: accept, end: to, tone: 'bg-consistent/25' },
  ].filter((zone) => zone.end > zone.start)

  return (
    <figure className="grid gap-2">
      <div className="relative h-3 rounded-full bg-muted" aria-hidden="true">
        {zones.map((zone) => (
          <span
            key={zone.label}
            className={`absolute inset-y-0 first:rounded-l-full last:rounded-r-full ${zone.tone}`}
            style={{ left: at(zone.start), right: `calc(100% - ${at(zone.end)})` }}
          />
        ))}
        <span
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground"
          style={{ left: at(score) }}
        />
      </div>
      <div className="flex justify-between font-mono text-xs text-muted-foreground" aria-hidden="true">
        {zones.map((zone) => (
          <span key={zone.label}>{zone.label}</span>
        ))}
      </div>
      <figcaption className="text-sm text-muted-foreground">
        Similarity {score.toFixed(2)} against thresholds {reject.toFixed(2)} and {accept.toFixed(2)}
        {decision.rounds > 1 && `, averaged over ${decision.rounds} rounds`}. This is a similarity score, not a
        probability that it is you.
      </figcaption>
    </figure>
  )
}
