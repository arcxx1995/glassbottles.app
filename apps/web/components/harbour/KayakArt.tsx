import { useId } from 'react'
import { HULL_COLOR, PADDLE_COLOR, type Hull, type Paddle } from '@/lib/harbour'

// A sit-on-top kayak seen from straight above, bow up, empty, with its paddle
// laid across the deck. viewBox 200×300: the hull is 76 wide and runs the full
// 300; the paddle overhangs both sides like in the reference photo.

export const KAYAK_HULL =
  'M100 6 C118 34 137 98 138 152 C139 206 124 262 100 294 C76 262 61 206 62 152 C63 98 82 34 100 6 Z'
const DECK =
  'M100 24 C113 47 129 103 130 152 C131 201 119 251 100 278 C81 251 69 201 70 152 C71 103 87 47 100 24 Z'

/** Mix a #rrggbb toward black (t<0) or white (t>0). */
function shade(hex: string, t: number) {
  const to = t < 0 ? 0 : 255
  const k = Math.abs(t)
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `rgb(${c.map((v) => Math.round(v + (to - v) * k)).join(',')})`
}

export default function KayakArt({
  hull,
  paddle,
  lantern = false,
  className,
}: {
  hull: Hull
  paddle: Paddle
  lantern?: boolean
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const h = HULL_COLOR[hull]
  const p = PADDLE_COLOR[paddle]

  return (
    <svg viewBox="0 0 200 300" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-hull`} x1="62" x2="138" y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={shade(h, -0.38)} />
          <stop offset="0.16" stopColor={shade(h, -0.08)} />
          <stop offset="0.48" stopColor={shade(h, 0.16)} />
          <stop offset="0.84" stopColor={shade(h, -0.1)} />
          <stop offset="1" stopColor={shade(h, -0.42)} />
        </linearGradient>
        <linearGradient id={`${id}-well`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={shade(h, -0.34)} />
          <stop offset="0.35" stopColor={shade(h, -0.16)} />
          <stop offset="1" stopColor={shade(h, -0.08)} />
        </linearGradient>
        <radialGradient id={`${id}-sheen`} cx="0.35" cy="0.3" r="0.55">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-lamp`}>
          <stop offset="0" stopColor="#FFE7A8" stopOpacity="0.95" />
          <stop offset="0.25" stopColor="#FFC56B" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFB24A" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* Where the hull meets the water: a thin bright wake. */}
      <path d={KAYAK_HULL} fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="5" filter={`url(#${id}-soft)`} />

      <path d={KAYAK_HULL} fill={`url(#${id}-hull)`} />
      <path d={DECK} fill={`url(#${id}-hull)`} stroke={shade(h, -0.3)} strokeOpacity="0.45" strokeWidth="1.2" />
      {/* Keel ridge catching light along the bow. */}
      <path d="M100 30 L100 128" stroke="#fff" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" />

      {/* Carry toggles. */}
      <rect x="95" y="9" width="10" height="5" rx="2.5" fill="#1C1E22" />
      <rect x="95" y="286" width="10" height="5" rx="2.5" fill="#1C1E22" />

      {/* Front hatch cover. */}
      <circle cx="100" cy="80" r="13" fill="#1B1D21" />
      <circle cx="100" cy="80" r="13" fill="none" stroke="#3B3F45" strokeWidth="1.6" />
      <path d="M92 75 A9 9 0 0 1 104 71" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="1.6" strokeLinecap="round" />

      {/* Foot wells. */}
      {[106, 118, 130, 142].map((y) => (
        <g key={y} fill={shade(h, -0.26)}>
          <ellipse cx="84" cy={y} rx="4.5" ry="2.4" />
          <ellipse cx="116" cy={y} rx="4.5" ry="2.4" />
        </g>
      ))}

      {/* Seat well, moulded into the deck, and its backrest. */}
      <rect x="79" y="150" width="42" height="66" rx="17" fill={`url(#${id}-well)`} />
      <rect x="79" y="150" width="42" height="66" rx="17" fill="none" stroke={shade(h, -0.45)} strokeOpacity="0.5" strokeWidth="1.2" />
      <rect x="83" y="204" width="34" height="10" rx="5" fill={shade(h, -0.04)} />
      {[160, 170, 180].map((y) => (
        <circle key={y} cx="100" cy={y} r="1.6" fill={shade(h, -0.4)} />
      ))}

      {/* Stern tank well with bungee. */}
      <rect x="84" y="228" width="32" height="36" rx="10" fill={shade(h, -0.16)} />
      <path d="M84 233 L116 259 M116 233 L84 259" stroke="#15171A" strokeWidth="1.6" strokeLinecap="round" />
      {[[84, 233], [116, 233], [84, 259], [116, 259]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 2.5} y={y - 2} width="5" height="4" rx="1" fill="#15171A" />
      ))}

      <path d={KAYAK_HULL} fill={`url(#${id}-sheen)`} />

      {/* Paddle, laid across the cockpit. */}
      <g transform="rotate(9 100 158)">
        <rect x="14" y="156" width="172" height="4" rx="2" fill="#2B2E33" />
        <rect x="14" y="156" width="172" height="1.4" rx="0.7" fill="#fff" fillOpacity="0.25" />
        {[
          'M30 158 C22 148 6 148 0 158 C6 168 22 168 30 158 Z',
          'M170 158 C178 148 194 148 200 158 C194 168 178 168 170 158 Z',
        ].map((d) => (
          <g key={d}>
            <path d={d} fill={p} />
            <path d={d} fill="none" stroke={shade(p, -0.35)} strokeWidth="1" />
          </g>
        ))}
        <path d="M4 158 L28 158 M172 158 L196 158" stroke={shade(p, -0.3)} strokeWidth="1.4" strokeLinecap="round" />
      </g>

      {lantern && (
        <g>
          <circle cx="100" cy="246" r="34" fill={`url(#${id}-lamp)`} />
          <circle cx="100" cy="246" r="4.5" fill="#FFF1C7" />
        </g>
      )}
    </svg>
  )
}

/** The hull's soft shadow on the seabed, cast down-right through the water. */
export function KayakShadow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 300" className={className} aria-hidden="true">
      <path d={KAYAK_HULL} fill="#00222E" fillOpacity="0.42" />
    </svg>
  )
}
