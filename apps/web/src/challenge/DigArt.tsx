/**
 * Dig-site artwork for the challenge tasks, drawn as a field survey sheet. Cosmetic only.
 *
 * Flat shapes, one accent: pen blue always means "act on this". Every interactive piece
 * is drawn around the origin and fills a circle of radius `r`, the task's real hit area,
 * so what people see is exactly what counts.
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

/** A marked spot to dig: a solid survey marker with a cross-hair. */
export function DigSpot({ r }: { r: number }) {
  const k = r * 0.46
  return (
    <>
      <circle r={r} className="fill-primary" />
      <path
        d={`M${-k} 0H${k}M0 ${-k}V${k}`}
        className="stroke-primary-foreground"
        strokeWidth={Math.max(1.75, r / 10)}
        strokeLinecap="round"
      />
    </>
  )
}

/** What a dug spot leaves behind: a depression in contour lines. Decoration; not clickable. */
export function Hole({ r }: { r: number }) {
  return (
    <>
      <circle
        r={r}
        className="origin-center animate-dug fill-none stroke-primary [transform-box:fill-box] motion-reduce:hidden"
        strokeWidth={2}
      />
      <g className="fill-none stroke-contour-deep" strokeWidth={1.25}>
        <circle r={r * 0.82} />
        <circle r={r * 0.48} />
      </g>
      <circle r={Math.max(1.5, r * 0.13)} className="fill-pit/55" />
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

/** The tunnelling marker to follow: the same solid accent disc as a dig spot, ringed instead of crossed. */
export function Digger({ r }: { r: number }) {
  return (
    <>
      <circle r={r} className="fill-primary" />
      <circle r={r * 0.42} className="fill-none stroke-primary-foreground" strokeWidth={2.5} />
    </>
  )
}
