'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BottleSVG } from './ThrowAnimation'

// ─── Perspective geometry ────────────────────────────────────────────────────
// One-point perspective boardwalk receding to the right. The near end (left) is
// tall/wide; the far end (right, over the water) converges. Both long edges and
// the plank spacing follow the same projection so it reads as real depth.

const L = 250 // deck length along x (SVG units)
const NF = { x: 0, y: 156 } // near-front (viewer-side, left)
const FF = { x: L, y: 122 } // far-front  (right tip)
const NB = { x: 0, y: 90 } //  near-back  (left)
const FB = { x: L, y: 104 } // far-back   (right tip)

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const frontY = (f: number) => lerp(NF.y, FF.y, f)
const backY = (f: number) => lerp(NB.y, FB.y, f)

function PierSVG() {
  // Plank fractions, compressed toward the far end via a perspective projection
  // (evenly spaced in depth z → non-linear on screen).
  const N = 12
  const zNear = 1
  const zFar = 6
  const planks = Array.from({ length: N + 1 }, (_, k) => {
    const z = lerp(zNear, zFar, k / N)
    return (1 - zNear / z) / (1 - zNear / zFar)
  })

  const posts = [0.07, 0.33, 0.62, 0.9]

  return (
    <svg
      viewBox="0 0 320 220"
      fill="none"
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      <defs>
        {/* Atmospheric depth: warm + lit near, cooler + darker far */}
        <linearGradient id="pier-deck" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={L} y2="0">
          <stop offset="0" stopColor="#A37C54" />
          <stop offset="0.55" stopColor="#866444" />
          <stop offset="1" stopColor="#634a33" />
        </linearGradient>
        <linearGradient id="pier-face" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={L} y2="0">
          <stop offset="0" stopColor="#5E4731" />
          <stop offset="1" stopColor="#3C2B1A" />
        </linearGradient>
        <filter id="pier-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feGaussianBlur stdDeviation="5.5" />
        </filter>
      </defs>

      {/* Soft shadow cast on the water */}
      <path
        d={`M4,${frontY(0) + 8} L${L + 10},${frontY(1) + 8} L${L + 18},${frontY(1) + 22} L14,${frontY(0) + 26} Z`}
        fill="rgba(0,0,0,0.32)"
        filter="url(#pier-shadow)"
      />

      {/* Support posts — bigger/longer near, smaller far; each with a base shadow
          and a seafoam waterline ripple */}
      {posts.map((f, i) => {
        const x = L * f
        const topY = frontY(f)
        const w = 9 - 6 * f
        const h = 80 - 54 * f
        return (
          <g key={i}>
            <ellipse cx={x + w / 2} cy={topY + h} rx={w * 1.5} ry={w * 0.5} fill="rgba(0,0,0,0.28)" />
            <rect x={x} y={topY} width={w} height={h} rx={1} fill="#3C2B1A" />
            <rect x={x} y={topY} width={w * 0.42} height={h} fill="#5E4731" />
            <ellipse
              cx={x + w / 2}
              cy={topY + h - 2}
              rx={w * 1.6}
              ry={w * 0.45}
              fill="none"
              stroke="#4ECDC4"
              strokeOpacity={0.18}
              strokeWidth={1.4}
            />
          </g>
        )
      })}

      {/* Front face (deck thickness), perspective-thinned toward the far end */}
      <path
        d={`M${NF.x},${NF.y} L${FF.x},${FF.y} L${FF.x},${FF.y + 11} L${NF.x},${NF.y + 17} Z`}
        fill="url(#pier-face)"
      />
      {/* Ambient occlusion seam where face meets deck */}
      <path d={`M${NF.x},${NF.y} L${FF.x},${FF.y}`} stroke="rgba(0,0,0,0.28)" strokeWidth={1.4} />

      {/* Deck top surface */}
      <path
        d={`M${NB.x},${NB.y} L${FB.x},${FB.y} L${FF.x},${FF.y} L${NF.x},${NF.y} Z`}
        fill="url(#pier-deck)"
      />

      {/* Plank seams (converge + compress toward the far end) */}
      {planks.map((f, i) => {
        const x = L * f
        return (
          <line
            key={i}
            x1={x}
            y1={backY(f)}
            x2={x}
            y2={frontY(f)}
            stroke="#4F381F"
            strokeWidth={Math.max(0.5, 1.4 - f)}
            strokeOpacity={0.6}
          />
        )
      })}

      {/* Lit back rim + a near-edge top highlight for sheen */}
      <path d={`M${NB.x},${NB.y} L${FB.x},${FB.y}`} stroke="#C0946A" strokeWidth={2} strokeLinecap="round" />
      <path
        d={`M${NF.x + 2},${NF.y - 2} L${NF.x + 60},${frontY(60 / L) - 2}`}
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  )
}

// ─── PierScene ───────────────────────────────────────────────────────────────
// idle     → pier is simply present (fades in, no slide); bottle wiggles on the
//            tip until thrown.
// dropping → pier slides out to the left; the bottle arcs off the tip into the
//            sea with a splash, then fires onDropComplete for the handover.

export default function PierScene({
  phase,
  onDropComplete,
}: {
  phase: 'idle' | 'dropping'
  onDropComplete?: () => void
}) {
  const reduced = useReducedMotion() ?? false
  const dropping = phase === 'dropping'

  return (
    <div className="absolute left-0 bottom-0 w-[74%] max-w-[340px] pointer-events-none select-none">
      {/* Pier slab — present from the start (no entrance), only slides out left
          on drop */}
      <motion.div
        initial={false}
        animate={dropping ? { x: '-120%', opacity: 0 } : { x: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <PierSVG />
      </motion.div>

      {/* Bottle on the tip */}
      <motion.div
        className="absolute"
        style={{ right: '18%', bottom: '50%' }}
        initial={false}
        animate={
          dropping
            ? reduced
              ? { opacity: 0 }
              : { x: [0, 18, 38], y: [0, -18, 150], rotate: [0, 26, 86], opacity: [1, 1, 0] }
            : { opacity: 1 }
        }
        transition={
          dropping
            ? reduced
              ? { duration: 0.3 }
              : { duration: 0.85, ease: [0.4, 0, 0.7, 1], times: [0, 0.38, 1] }
            : { duration: 0.6 }
        }
        onAnimationComplete={() => {
          if (dropping) onDropComplete?.()
        }}
      >
        {/* Inner: nervous wiggle while it waits on the pier */}
        <motion.div
          animate={
            dropping || reduced
              ? undefined
              : { rotate: [-5, 6, -4, 5, -5], x: [0, 1.5, -1.5, 1, 0] }
          }
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '50% 90%' }}
        >
          <BottleSVG glowing width={46} height={70} />
        </motion.div>
      </motion.div>

      {/* Splash where the bottle meets the water */}
      {dropping && !reduced && (
        <motion.div
          className="absolute"
          style={{ right: '8%', bottom: '2%', width: 70, height: 26 }}
          initial={{ opacity: 0, scale: 0.2 }}
          animate={{ opacity: [0, 0.7, 0], scale: [0.2, 1.3, 1.7] }}
          transition={{ duration: 0.6, delay: 0.5, ease: 'easeOut' }}
        >
          <svg viewBox="0 0 70 26" fill="none" style={{ width: '100%', height: '100%' }}>
            <ellipse cx={35} cy={13} rx={32} ry={10} stroke="#4ECDC4" strokeOpacity={0.6} strokeWidth={2} />
            <ellipse cx={35} cy={13} rx={20} ry={6} stroke="#4ECDC4" strokeOpacity={0.35} strokeWidth={1.5} />
          </svg>
        </motion.div>
      )}
    </div>
  )
}
