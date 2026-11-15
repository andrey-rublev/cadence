/**
 * Dig-site artwork for the challenge tasks, drawn as a field survey sheet. Cosmetic only.
 *
 * Each interactive piece is centered on the origin and uses the task's hit radius `r`.
 */

import { SHEET } from './sheet'

const COLUMNS = 'ABCDEFGH'
const GRID = 100

/** Static survey furniture: contour lines, grid ticks and edge references. */
export function SurveyGround() {
  let ticks = ''
  for (let x = GRID; x < SHEET.w; x += GRID) {
    for (let y = GRID; y < SHEET.h; y += GRID) ticks += `M${x - 4} ${y}h8M${x} ${y - 4}v8`
  }
  return (
    <g>
      <g className="fill-none stroke-contour" strokeWidth={1.25}>
        <ellipse cx={205} cy={185} rx={150} ry={96} transform="rotate(-14 205 185)" />
        <ellipse cx={198} cy={180} rx={104} ry={62} transform="rotate(-14 198 180)" />
        <ellipse cx={190} cy={176} rx={56} ry={30} transform="rotate(-14 190 176)" />
        <ellipse cx={600} cy={320} rx={176} ry={112} transform="rotate(9 600 320)" />
        <ellipse cx={606} cy={324} rx={128} ry={78} transform="rotate(9 606 324)" />
        <ellipse cx={612} cy={328} rx={80} ry={44} transform="rotate(9 612 328)" />
        <ellipse cx={618} cy={331} rx={34} ry={16} transform="rotate(9 618 331)" />
        <path d="M0 452C140 404 290 486 460 452S700 470 800 424" />
        <path d="M0 40C120 70 260 18 420 44S660 20 800 58" />
      </g>
      <path d={ticks} className="fill-none stroke-contour-deep" strokeWidth={1} />
      <g className="fill-contour-deep font-mono text-[10px]" textAnchor="middle">
        {[...COLUMNS].map((letter, i) => (
          <text key={letter} x={i * GRID + GRID / 2} y={14}>
            {letter}
          </text>
        ))}
        {[1, 2, 3, 4, 5].map((n) => (
          <text key={n} x={10} y={(n - 1) * GRID + GRID / 2 + 3}>
            {n}
          </text>
        ))}
      </g>
    </g>
  )
}

/** A seam of ore, with a bright crystal visible at the surface. */
export function DigSpot({ r }: { r: number }) {
  return (
    <>
      <circle r={r} className="fill-pit" />
      <g transform={`scale(${r / 24})`}>
        <path d="M-14 -3 -7 -12H7L14 -3 0 13Z" className="fill-brass" />
        <path d="M-14 -3H14L0 13Z" className="fill-brass-deep" />
        <path d="M-5 -3 0 -12 5 -3 0 13Z" className="fill-ground-light" />
      </g>
    </>
  )
}

/** Loose soil around the pit left by an excavated spot. */
export function Hole({ r }: { r: number }) {
  return (
    <>
      <circle
        r={r}
        className="origin-center animate-dug fill-none stroke-brass-deep [transform-box:fill-box] motion-reduce:hidden"
        strokeWidth={2}
      />
      <circle r={r * 0.82} className="fill-contour stroke-contour-deep" strokeWidth={1.25} />
      <circle r={r * 0.55} className="fill-pit/75" />
      <circle cy={r * 0.1} r={r * 0.34} className="fill-pit" />
    </>
  )
}

/** A find to carry: a flat brass disc with a square centre. */
export function Find({ r, held }: { r: number; held: boolean }) {
  const s = r * 0.2
  return (
    <>
      <circle
        r={r - 1.25}
        className={held ? 'fill-brass stroke-primary' : 'fill-brass stroke-brass-deep'}
        strokeWidth={held ? 2.5 : 1.5}
      />
      <circle r={r * 0.6} className="fill-none stroke-brass-deep" strokeWidth={1.25} />
      <rect x={-s} y={-s} width={2 * s} height={2 * s} rx={1.5} className="fill-ground" />
    </>
  )
}

/** Where finds go: a finds tray, outlined inside the dashed drop ring. */
export function Tray({ r }: { r: number }) {
  const s = r * 0.56
  return (
    <>
      <circle r={r - 1} className="fill-ground-light stroke-primary" strokeWidth={2} strokeDasharray="5 5" />
      <rect x={-s} y={-s} width={2 * s} height={2 * s} rx={4} className="fill-none stroke-pit/45" strokeWidth={1.5} />
    </>
  )
}

/** The drill head to follow, drawn from above. */
export function Digger({ r }: { r: number }) {
  return (
    <>
      <circle r={r} className="fill-primary" />
      <g transform={`scale(${r / 24})`} className="fill-none stroke-primary-foreground" strokeWidth={2.5}>
        <circle r={11} />
        <path d="M0 -11V-4M11 0H4M0 11V4M-11 0H-4" strokeLinecap="round" />
      </g>
    </>
  )
}
