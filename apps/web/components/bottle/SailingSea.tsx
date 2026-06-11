'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  motion,
  AnimatePresence,
  useAnimationControls,
  useReducedMotion,
} from 'framer-motion'
import { BottleSVG } from './ThrowAnimation'

export interface SailingBottleItem {
  id: string
  day_key: string
}

// ─── Deterministic pseudo-random helpers ─────────────────────────────────────
// Positions must be stable across re-renders (otherwise bottles teleport on
// every state change). We seed everything off a hash of the bottle id.

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Deterministic 0..1 from an integer seed. */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function formatDay(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dayKey
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Tiling wave path ────────────────────────────────────────────────────────
// Builds a smooth wave across `width` whose left and right halves are identical,
// so translating the layer by -50% loops seamlessly. `period` must divide 1440
// into an even number of half-periods (e.g. 720, 480, 360, 288, 240).

/** Open wavy top edge from x=0 to x=width. */
function waveEdge(width: number, baseY: number, amp: number, period: number): string {
  const half = period / 2
  let d = `M0,${baseY}`
  let x = 0
  let up = true
  while (x < width) {
    const nx = x + half
    const cy = baseY + (up ? -amp : amp)
    d += ` Q${x + half / 2},${cy.toFixed(1)} ${nx},${baseY}`
    x = nx
    up = !up
  }
  return d
}

/** Filled wave: the edge closed down to the bottom of the viewBox. */
function wavePath(width: number, baseY: number, amp: number, period: number, h: number): string {
  return `${waveEdge(width, baseY, amp, period)} L${width},${h} L0,${h} Z`
}

const VIEW_W = 2880 // 2× the 1440 tile
const VIEW_H = 240

// back (high, lighter, slow) → front (low, darker, fast)
const WAVE_BANDS = [
  { top: '40%', height: 150, fill: '#173B54', opacity: 0.55, dur: 30, amp: 10, period: 720, baseY: 70, bob: 4 },
  { top: '50%', height: 160, fill: '#123247', opacity: 0.70, dur: 24, amp: 14, period: 480, baseY: 66, bob: 5 },
  { top: '60%', height: 170, fill: '#0E2840', opacity: 0.85, dur: 19, amp: 18, period: 360, baseY: 60, bob: 6 },
  { top: '71%', height: 180, fill: '#0B2034', opacity: 0.94, dur: 15, amp: 22, period: 288, baseY: 56, bob: 7 },
  { top: '82%', height: 200, fill: '#07141F', opacity: 1, dur: 12, amp: 26, period: 240, baseY: 52, bob: 8, foam: true },
] as const

function WaveBand({ band, reduced }: { band: (typeof WAVE_BANDS)[number]; reduced: boolean }) {
  const d = useMemo(
    () => wavePath(VIEW_W, band.baseY, band.amp, band.period, VIEW_H),
    [band]
  )
  const foamD = useMemo(
    () => waveEdge(VIEW_W, band.baseY, band.amp, band.period),
    [band]
  )

  return (
    <motion.div
      className="absolute left-0"
      style={{ top: band.top, width: '200%', height: band.height, opacity: band.opacity }}
      animate={reduced ? undefined : { y: [0, -band.bob, 0] }}
      transition={{ duration: band.dur / 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      <motion.div
        style={{ width: '100%', height: '100%' }}
        animate={reduced ? undefined : { x: ['0%', '-50%'] }}
        transition={{ duration: band.dur, repeat: Infinity, ease: 'linear' }}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          <path d={d} fill={band.fill} />
          {band.foam && (
            <path d={foamD} fill="none" stroke="#4ECDC4" strokeOpacity={0.18} strokeWidth={2} />
          )}
        </svg>
      </motion.div>
    </motion.div>
  )
}

// ─── Distant ship ────────────────────────────────────────────────────────────

function Ship({
  topPct,
  scale,
  opacity,
  dur,
  delay,
  dir,
  reduced,
}: {
  topPct: number
  scale: number
  opacity: number
  dur: number
  delay: number
  dir: 1 | -1
  reduced: boolean
}) {
  // Travel fully across the stage and a bit beyond on both sides.
  const from = dir === 1 ? '-20%' : '120%'
  const to = dir === 1 ? '120%' : '-20%'

  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ top: `${topPct}%`, left: 0, opacity }}
      initial={{ x: from }}
      animate={reduced ? { x: '50%' } : { x: [from, to] }}
      transition={{ duration: dur, repeat: Infinity, ease: 'linear', delay }}
    >
      <motion.div
        animate={reduced ? undefined : { y: [0, -3, 0], rotate: [-1.5, 1.5, -1.5] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transform: `scaleX(${dir})` }}
      >
        <svg
          width={64 * scale}
          height={52 * scale}
          viewBox="0 0 64 52"
          fill="none"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
        >
          {/* sails */}
          <path d="M32 6 L32 34 L14 34 Q22 18 32 6 Z" fill="#1C4A63" />
          <path d="M34 12 L34 34 L50 34 Q44 22 34 12 Z" fill="#16384C" />
          {/* mast */}
          <rect x="31" y="4" width="1.6" height="32" fill="#0E2433" />
          {/* hull */}
          <path d="M10 36 L54 36 L48 46 Q32 50 16 46 Z" fill="#0B1E2D" />
          <path d="M10 36 L54 36 L52 39 L12 39 Z" fill="#1C4A63" fillOpacity="0.5" />
        </svg>
      </motion.div>
    </motion.div>
  )
}

// ─── Lightning ───────────────────────────────────────────────────────────────
// Full-scene flash + a jagged bolt near the horizon, fired at randomized
// intervals. Disabled under prefers-reduced-motion.

function Lightning() {
  const flash = useAnimationControls()
  const bolt = useAnimationControls()
  const [boltX, setBoltX] = useState(30)

  useEffect(() => {
    let active = true
    async function loop() {
      while (active) {
        const wait = 6000 + Math.random() * 9000
        await new Promise((r) => setTimeout(r, wait))
        if (!active) break
        setBoltX(15 + Math.random() * 60)
        bolt.start({
          opacity: [0, 0.9, 0.2, 0.7, 0],
          transition: { duration: 0.7, times: [0, 0.08, 0.22, 0.4, 1] },
        })
        await flash.start({
          opacity: [0, 0.5, 0.08, 0.32, 0],
          transition: { duration: 0.9, times: [0, 0.08, 0.25, 0.42, 1] },
        })
      }
    }
    loop()
    return () => {
      active = false
    }
  }, [flash, bolt])

  return (
    <>
      {/* Scene flash */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 0%, rgba(174,224,255,0.55) 0%, rgba(78,205,196,0.12) 35%, transparent 70%)',
          mixBlendMode: 'screen',
        }}
        initial={{ opacity: 0 }}
        animate={flash}
      />
      {/* Bolt */}
      <motion.div
        className="absolute pointer-events-none"
        style={{ top: '8%', left: `${boltX}%`, width: 60, height: 150 }}
        initial={{ opacity: 0 }}
        animate={bolt}
      >
        <svg viewBox="0 0 60 150" fill="none" style={{ width: '100%', height: '100%' }}>
          <path
            d="M34 0 L18 64 L32 64 L14 150 L46 56 L30 56 L42 0 Z"
            fill="#DCF4FF"
            style={{ filter: 'drop-shadow(0 0 8px rgba(174,224,255,0.9))' }}
          />
        </svg>
      </motion.div>
    </>
  )
}

// ─── FloatingBottle ──────────────────────────────────────────────────────────
// A single bottle dipped into the sea: bobbing, with a date pill above, a water
// cap clipping its base, and expanding ripple rings.

function FloatingBottle({ item }: { item: SailingBottleItem }) {
  const layout = useMemo(() => {
    const seed = hashId(item.id)
    const depth = rand(seed + 1) // 0 = far/back, 1 = near/front
    return {
      left: 7 + rand(seed) * 84, // %
      top: 50 + depth * 36, // % of viewport — back bottles higher (near horizon)
      scale: 0.6 + depth * 0.5,
      opacity: 0.62 + depth * 0.38,
      z: Math.round(depth * 100),
      bobDelay: rand(seed + 2) * 4,
      bobDur: 3 + rand(seed + 3) * 2.4,
      drift: rand(seed + 4) > 0.5 ? 1 : -1,
    }
  }, [item.id])

  const W = 52
  const H = 78

  return (
    // Static wrapper owns absolute position + centering; Framer never touches it.
    <div
      className="absolute"
      style={{
        left: `${layout.left}%`,
        top: `${layout.top}%`,
        zIndex: layout.z,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0, y: 18, scale: layout.scale * 0.7 }}
        animate={{ opacity: layout.opacity, y: 0, scale: layout.scale }}
        exit={{
          opacity: 0,
          y: -40,
          scale: layout.scale * 0.4,
          transition: { duration: 0.7, ease: 'easeIn' },
        }}
        transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
      {/* Date pill hovering above */}
      <span className="font-mono text-[9px] text-seafoam/80 bg-ocean-deep/60 backdrop-blur-sm border border-seafoam/15 px-1.5 py-0.5 rounded-full whitespace-nowrap mb-1">
        {formatDay(item.day_key)}
      </span>

      {/* Bottle + waterline, bobbing as one unit */}
      <motion.div
        style={{ position: 'relative', width: W, height: H }}
        animate={{
          y: [0, -6, 0],
          rotate: [-2.5 * layout.drift, 2.5 * layout.drift, -2.5 * layout.drift],
        }}
        transition={{
          duration: layout.bobDur,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: layout.bobDelay,
        }}
      >
        <BottleSVG glowing width={W} height={H} />

        {/* Water cap — clips the bottle's submerged base */}
        <div
          className="absolute left-1/2 pointer-events-none"
          style={{
            bottom: -2,
            width: W * 1.05,
            height: H * 0.26,
            transform: 'translateX(-50%)',
            background:
              'linear-gradient(to bottom, rgba(11,32,53,0.0) 0%, rgba(9,26,43,0.82) 45%, rgba(7,20,31,0.96) 100%)',
            borderRadius: '50% 50% 40% 40% / 70% 70% 30% 30%',
          }}
        />
        {/* Seafoam waterline glint */}
        <div
          className="absolute left-1/2 pointer-events-none"
          style={{
            bottom: H * 0.24,
            width: W * 0.9,
            height: 2,
            transform: 'translateX(-50%)',
            background:
              'linear-gradient(to right, transparent, rgba(78,205,196,0.5), transparent)',
            borderRadius: 2,
          }}
        />

        {/* Expanding ripple rings at the waterline */}
        {[0, 1].map((r) => (
          <motion.div
            key={r}
            className="absolute left-1/2 pointer-events-none"
            style={{
              bottom: H * 0.12,
              width: W * 0.8,
              height: W * 0.32,
              transform: 'translateX(-50%)',
              border: '1px solid rgba(78,205,196,0.35)',
              borderRadius: '50%',
            }}
            animate={{ scale: [0.5, 1.4], opacity: [0.5, 0] }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'easeOut',
              delay: layout.bobDelay + r * 1.5,
            }}
          />
        ))}
      </motion.div>
      </motion.div>
    </div>
  )
}

// ─── SailingSea ──────────────────────────────────────────────────────────────
// The full artsy sea stage. Layered turbulent waves + distant ships + lightning,
// with the user's undelivered bottles dipped and scattered across the water.
// When a bottle is matched it drops out of `bottles` and floats away.

export default function SailingSea({ bottles }: { bottles: SailingBottleItem[] }) {
  const reduced = useReducedMotion() ?? false

  return (
    // Full-viewport background layer. Sits inside AppShell's `main` (z-10) at
    // z-0 — above WaveBackground, below the foreground content. Only opacity is
    // animated so the `fixed` stays relative to the viewport (a transform here
    // would create a containing block and break full-screen positioning).
    <motion.div
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeInOut' }}
    >
      {/* Sky → horizon gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, #0A1628 0%, #0C2030 30%, #123A52 40%, #0E2B43 52%, #081826 100%)',
        }}
      />
      {/* Horizon glow */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: '34%',
          height: 80,
          background:
            'radial-gradient(80% 100% at 50% 100%, rgba(78,205,196,0.18) 0%, transparent 70%)',
        }}
      />

      {/* Distant ships (behind the front waves) */}
      <Ship topPct={33} scale={0.7} opacity={0.45} dur={70} delay={0} dir={1} reduced={reduced} />
      <Ship topPct={37} scale={1} opacity={0.6} dur={95} delay={12} dir={-1} reduced={reduced} />
      <Ship topPct={35} scale={0.55} opacity={0.35} dur={120} delay={40} dir={1} reduced={reduced} />

      {/* Turbulent sea bands */}
      {WAVE_BANDS.map((band, i) => (
        <WaveBand key={i} band={band} reduced={reduced} />
      ))}

      {/* Lightning over the scene */}
      {!reduced && <Lightning />}

      {/* Floating bottles dipped in the water */}
      <AnimatePresence>
        {bottles.map((b) => (
          <FloatingBottle key={b.id} item={b} />
        ))}
      </AnimatePresence>

      {/* Vignette for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(4,10,18,0.55) 100%)',
        }}
      />
    </motion.div>
  )
}
