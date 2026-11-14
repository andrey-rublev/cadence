/**
 * Dig-site artwork for the challenge tasks. Cosmetic only.
 *
 * Every piece is drawn around the origin and fills a circle of radius `r`, which is the
 * task's real hit area, so what people see is exactly what counts.
 */

/** A marked spot to dig: a mound of earth with an X and a survey ring. */
export function DigSpot({ r }: { r: number }) {
  const k = r * 0.36
  return (
    <>
      <circle r={r} className="fill-earth" />
      <ellipse cx={-r * 0.18} cy={-r * 0.24} rx={r * 0.56} ry={r * 0.4} className="fill-earth-light" />
      <path
        d={`M${-k} ${-k}L${k} ${k}M${k} ${-k}L${-k} ${k}`}
        className="stroke-soil"
        strokeWidth={Math.max(2.5, r / 6)}
        strokeLinecap="round"
      />
      <circle r={r - 1} className="fill-none stroke-primary" strokeWidth={2} />
    </>
  )
}

/** What a dig spot leaves behind. Decoration; it cannot be clicked. */
export function Hole({ r }: { r: number }) {
  return (
    <g className="opacity-70">
      <circle r={r * 0.92} className="fill-soil-deep" />
      <circle r={r * 0.62} className="fill-pit" />
      <ellipse cx={r * 0.1} cy={r * 0.16} rx={r * 0.4} ry={r * 0.3} className="fill-earth" />
    </g>
  )
}

/** A find to carry: a gold nugget. */
export function Find({ r, held }: { r: number; held: boolean }) {
  return (
    <>
      <circle r={r - 1} className={held ? 'fill-find stroke-primary' : 'fill-find stroke-earth'} strokeWidth={2} />
      <path
        d={`M${-r * 0.5} ${-r * 0.08}L${-r * 0.12} ${-r * 0.55}L${r * 0.42} ${-r * 0.3}L${r * 0.12} ${r * 0.05}Z`}
        className="fill-find-light"
      />
      <path
        d={`M${-r * 0.5} ${-r * 0.08}L${r * 0.12} ${r * 0.05}L${r * 0.42} ${-r * 0.3}M${r * 0.12} ${r * 0.05}L${-r * 0.1} ${r * 0.55}`}
        className="fill-none stroke-earth/45"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </>
  )
}

/** Where finds go: an open crate seen from above, inside the dashed drop ring. */
export function Crate({ r }: { r: number }) {
  const s = r * 0.6
  return (
    <>
      <circle r={r - 1} className="fill-soil-deep/60 stroke-primary" strokeWidth={2} strokeDasharray="6 6" />
      <rect x={-s} y={-s} width={2 * s} height={2 * s} rx={3} className="fill-wood stroke-earth" strokeWidth={2} />
      <rect x={-s * 0.68} y={-s * 0.68} width={s * 1.36} height={s * 1.36} rx={2} className="fill-pit/55" />
    </>
  )
}

/** The mole to follow, facing +x. The caller rotates it to face its direction of travel. */
export function Mole({ r }: { r: number }) {
  return (
    <>
      <circle r={r} className="fill-mole" />
      <ellipse cx={-r * 0.18} rx={r * 0.6} ry={r * 0.5} className="fill-mole-light" />
      <ellipse cx={r * 0.4} cy={-r * 0.66} rx={r * 0.2} ry={r * 0.13} className="fill-snout" />
      <ellipse cx={r * 0.4} cy={r * 0.66} rx={r * 0.2} ry={r * 0.13} className="fill-snout" />
      <circle cx={r * 0.5} cy={-r * 0.26} r={1.8} className="fill-soil" />
      <circle cx={r * 0.5} cy={r * 0.26} r={1.8} className="fill-soil" />
      <circle cx={r * 0.78} r={r * 0.17} className="fill-snout" />
    </>
  )
}
