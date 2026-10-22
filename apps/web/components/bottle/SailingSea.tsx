'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import {
  motion,
  AnimatePresence,
  useAnimationControls,
  useReducedMotion,
} from 'motion/react'
import { BottleSVG } from './ThrowAnimation'
import { useGetAtelierQuery } from '@/store/api/bottleApi'
import { resolveLook, type BottleStyle, type SeaTheme } from '@/lib/dressing'
import { easeOut } from '@/components/ui/springs'

export interface SailingBottleItem {
  id: string
  day_key: string
  /** Your own Atelier dressing (042). */
  style?: BottleStyle | null
}

// ─── Deterministic pseudo-random helpers ─────────────────────────────────────
// Positions must be stable across re-renders (otherwise bottles teleport on
// every state change). We seed everything off a hash of the bottle id.

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Deterministic 0..1 from an integer seed. Rounded so server and browser
 *  agree to the digit (Math.sin's tail differs between engines → hydration
 *  mismatches on inline positions). */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return Math.round((x - Math.floor(x)) * 1e4) / 1e4
}

/**
 * Where a bottle with this day_key sits in the sea (viewport %). Exported so
 * TetheredBottle can throw TO this exact spot — the optimistic FloatingBottle
 * (same day_key, same hash) then surfaces in place, no teleport.
 */
export function computeSeaSpot(dayKey: string) {
  const seed = hashId(dayKey)
  const depth = rand(seed + 1) // 0 = far/back, 1 = near/front
  return {
    left: 7 + rand(seed) * 84, // % of viewport
    top: 50 + depth * 36, // % — back bottles higher (near horizon)
    scale: 0.6 + depth * 0.5,
    depth,
    drift: rand(seed + 4) > 0.5 ? 1 : -1,
  }
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

function WaveBand({
  band,
  reduced,
  fill,
  foam,
}: {
  band: (typeof WAVE_BANDS)[number]
  reduced: boolean
  fill?: string
  foam?: string
}) {
  const d = useMemo(
    () => wavePath(VIEW_W, band.baseY, band.amp, band.period, VIEW_H),
    [band]
  )
  const foamD = useMemo(
    () => waveEdge(VIEW_W, band.baseY, band.amp, band.period),
    [band]
  )

  return (
    <div
      className="absolute left-0"
      style={{
        top: band.top,
        width: '200%',
        height: band.height,
        opacity: band.opacity,
        ['--gb-bob' as string]: `${-band.bob}px`,
        animation: reduced ? undefined : `gb-bob ${band.dur / 3}s ease-in-out infinite`,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          animation: reduced ? undefined : `gb-drift ${band.dur}s linear infinite`,
        }}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          <path d={d} style={{ fill: fill ?? band.fill, transition: 'fill 1.2s ease' }} />
          {'foam' in band && band.foam && (
            <path d={foamD} fill="none" stroke={foam ?? '#4ECDC4'} strokeOpacity={0.18} strokeWidth={2} />
          )}
        </svg>
      </div>
    </div>
  )
}

// ─── Distant ship ────────────────────────────────────────────────────────────

// ─── Keeper lighthouse ──────────────────────────────────────────────────────
// Only on a Keeper's own sea, never shown to anyone else. The lamp grows with
// each month of membership; after a lapse it stays, dimmed, beam off.

function Lighthouse({ glow, lit, reduced }: { glow: number; lit: boolean; reduced: boolean }) {
  return (
    <div
      className="absolute"
      data-lighthouse={lit ? 'lit' : 'dim'}
      style={{ left: '5%', top: '45.5%', transform: 'translateY(-100%)' }}
    >
      {lit && (
        <div
          className="absolute left-[13px] top-[6px] h-[3px] w-[140px] origin-left"
          style={{
            background: `linear-gradient(90deg, rgba(255,236,170,${0.55 * glow}), transparent)`,
            animation: reduced ? undefined : 'gb-beam 9s ease-in-out infinite',
            filter: 'blur(1px)',
          }}
        />
      )}
      <svg width="26" height="46" viewBox="0 0 26 46" fill="none">
        <circle cx="13" cy="7" r={lit ? 7 : 4} fill={`rgba(255,236,170,${lit ? 0.35 * glow : 0.08})`} />
        <rect x="9" y="3" width="8" height="7" rx="1.5" fill={lit ? `rgba(255,236,170,${0.5 + 0.5 * glow})` : '#3A4A57'} />
        <path d="M8 3 L13 0 L18 3 Z" fill="#0E2433" />
        <path d="M9 10 L17 10 L19 40 L7 40 Z" fill="#163447" />
        <path d="M8.6 18 H17.4 M8 27 H18" stroke="#21516B" strokeWidth="2" />
        <path d="M2 46 Q6 38 13 39 Q20 38 24 46 Z" fill="#0B1E2D" />
      </svg>
    </div>
  )
}

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
  // Travel across the viewport, just off both edges (vw, not element %). Small
  // margins keep the off-screen gap short so coverage stays dense. Loop jumps
  // far edge → start edge (both off-screen): a ship sails away, then re-enters
  // from the opposite side.
  const from = dir === 1 ? '-8vw' : '108vw'
  const to = dir === 1 ? '108vw' : '-8vw'

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: `${topPct}%`,
        left: 0,
        opacity,
        ['--gb-from' as string]: from,
        ['--gb-to' as string]: to,
        // backwards: hold at `from` (off-screen) through the start delay.
        transform: reduced ? 'translateX(50vw)' : undefined,
        animation: reduced ? undefined : `gb-sail ${dur}s linear ${delay}s infinite backwards`,
      }}
    >
      {/* Lift so the hull waterline (y59/72 in the viewBox ≈ 82%) rests on
          `topPct` — i.e. topPct marks the horizon, not the ship's top. */}
      <div style={{ transform: 'translateY(-82%)' }}>
      <div
        style={{
          ['--gb-bob' as string]: '-2.5px',
          ['--gb-rot-a' as string]: '-1.8deg',
          ['--gb-rot-b' as string]: '1.8deg',
          animation: reduced ? undefined : 'gb-sway 7s ease-in-out infinite',
        }}
      >
      <div style={{ transform: `scaleX(${dir})` }}>
        <svg
          width={100 * scale}
          height={72 * scale}
          viewBox="0 0 100 72"
          fill="none"
          style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.45))' }}
        >
          {/* bowsprit + rigging spar */}
          <path d="M14 44 L2 33" stroke="#0E2433" strokeWidth="1.4" strokeLinecap="round" />
          {/* masts */}
          <rect x="31.2" y="9" width="1.6" height="38" fill="#0E2433" />
          <rect x="51" y="5" width="1.8" height="44" fill="#0E2433" />
          <rect x="69.2" y="14" width="1.5" height="33" fill="#0E2433" />
          {/* square sails — billowed, lighter than hull */}
          <g fill="#21516B">
            <path d="M22 26 Q32 30 42 26 L42 40 Q32 43 22 40 Z" />
            <path d="M24 12 Q32 15 40 12 L40 24 Q32 27 24 24 Z" />
            <path d="M40 24 Q52 29 64 24 L64 40 Q52 44 40 40 Z" />
            <path d="M42 8 Q52 11 62 8 L62 22 Q52 25 42 22 Z" />
            <path d="M62 28 Q70 31 78 28 L78 40 Q70 42 62 40 Z" />
            <path d="M63 16 Q70 18 77 16 L77 26 Q70 28 63 26 Z" />
          </g>
          {/* wind-lit sail edge */}
          <g fill="#3A7591" fillOpacity="0.45">
            <path d="M40 12 Q42 13 42 14 L42 24 Q40 23 40 24 Z" />
            <path d="M62 8 Q64 9 64 10 L64 22 Q62 21 62 22 Z" />
          </g>
          {/* pennants */}
          <path d="M52.8 5 L63 7 L52.8 9 Z" fill="#2E6B85" />
          {/* stern castle (raised aft deck) */}
          <path d="M74 46 L88 43 L88 33 L80 33 Q75 39 74 46 Z" fill="#0A1B28" />
          {/* hull — old wooden crescent, bow + stern rise */}
          <path
            d="M10 43 C 9 51, 20 59, 50 59 C 80 59, 91 51, 90 43 C 85 48, 70 51, 50 51 C 30 51, 16 48, 10 43 Z"
            fill="#0B1E2D"
          />
          {/* hull gunwale highlight */}
          <path d="M12 44 Q50 50 88 44 L86 46 Q50 51 14 46 Z" fill="#21516B" fillOpacity="0.5" />
        </svg>
      </div>
      </div>
      </div>
    </div>
  )
}

// ─── Storm clouds ──────────────────────────────────────────────────────────────
// A slow-drifting cloud bank across the top of the sky. At randomized intervals
// one cluster throbs with an internal flash — a flicker of light buried inside
// the clouds (no sharp bolt). A soft scene flash washes the sea below.
// Disabled under prefers-reduced-motion.

// Soft cloud blobs, positioned (%) across ONE 100%-viewport tile. The bank is
// 200% wide and loops by translating -50%, so each blob renders twice — at
// left/2 and left/2 + 50 (both halves identical) — or the loop restart jumps.
const CLOUD_BLOBS = [
  { left: 6, top: 14, w: 220, h: 90, o: 0.85 },
  { left: 15, top: 6, w: 300, h: 120, o: 0.95 },
  { left: 30, top: 18, w: 180, h: 76, o: 0.7 },
  { left: 40, top: 9, w: 260, h: 104, o: 0.9 },
  { left: 56, top: 16, w: 200, h: 84, o: 0.8 },
  { left: 66, top: 7, w: 300, h: 118, o: 0.92 },
  { left: 82, top: 15, w: 220, h: 90, o: 0.82 },
] as const

function StormClouds({ reduced }: { reduced: boolean }) {
  const flash = useAnimationControls()
  const [origin, setOrigin] = useState({ x: 50, y: 11 })

  useEffect(() => {
    if (reduced) return
    let active = true
    async function loop() {
      while (active) {
        const wait = 5000 + Math.random() * 8000
        await new Promise((r) => setTimeout(r, wait))
        if (!active) break
        setOrigin({ x: 18 + Math.random() * 64, y: 7 + Math.random() * 10 })
        // Throbbing flicker buried in the cloud — multi-stage rise/fall.
        await flash.start({
          opacity: [0, 0.7, 0.22, 0.9, 0.12, 0.5, 0],
          transition: {
            duration: 1.6,
            times: [0, 0.06, 0.14, 0.24, 0.36, 0.52, 1],
            ease: 'easeOut',
          },
        })
      }
    }
    loop()
    return () => {
      active = false
    }
  }, [flash, reduced])

  return (
    <>
      {/* Drifting cloud bank (200% wide → loops by translating -50%) */}
      <div
        className="absolute left-0 top-0 pointer-events-none"
        style={{
          width: '200%',
          height: '34%',
          animation: reduced ? undefined : 'gb-drift 160s linear infinite',
        }}
      >
        {CLOUD_BLOBS.flatMap((c, i) => [
          { ...c, left: c.left / 2, key: i },
          { ...c, left: c.left / 2 + 50, key: i + CLOUD_BLOBS.length },
        ]).map((c) => (
          <div
            key={c.key}
            className="absolute"
            style={{
              left: `${c.left}%`,
              top: `${c.top}%`,
              width: c.w,
              height: c.h,
              opacity: c.o,
              // translateZ promotes each blurred blob to its own layer so the
              // blur(10px) rasterizes once instead of repainting every frame
              // of the bank's drift.
              transform: 'translateX(-50%) translateZ(0)',
              background:
                'radial-gradient(50% 50% at 50% 50%, rgba(20,40,58,0.95) 0%, rgba(13,30,46,0.6) 45%, rgba(10,22,40,0) 72%)',
              filter: 'blur(10px)',
            }}
          />
        ))}
      </div>

      {/* Internal cloud flash — lights up the bank from within, then a soft
          wash spills down over the sea. */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(42% 30% at ${origin.x}% ${origin.y}%, rgba(206,236,255,0.9) 0%, rgba(120,200,210,0.28) 38%, rgba(78,205,196,0.05) 60%, transparent 75%)`,
          mixBlendMode: 'screen',
        }}
        initial={{ opacity: 0 }}
        animate={flash}
      />
    </>
  )
}

// ─── FloatingBottle ──────────────────────────────────────────────────────────
// A single bottle dipped into the sea: bobbing, with a date pill above, a water
// cap clipping its base, and expanding ripple rings.

function FloatingBottle({ item }: { item: SailingBottleItem }) {
  const { data: pieces } = useGetAtelierQuery()
  const look = item.style ? resolveLook(item.style, pieces) : undefined
  // Stable hash-seeded scatter. Seeded by day_key (one bottle per day) so an
  // optimistic just-thrown placeholder and the real refetched bottle — same
  // day_key — land on the SAME spot (no jump on swap).
  const layout = useMemo(() => {
    const spot = computeSeaSpot(item.day_key)

    // Which wave band the bottle floats on (by vertical position). Its bob is
    // matched to that band's vertical wave frequency (and phase) so the bottle
    // rides the wave instead of bobbing on its own clock.
    let bandIndex = 0
    for (let i = 0; i < WAVE_BANDS.length; i++) {
      if (spot.top >= parseFloat(WAVE_BANDS[i].top)) bandIndex = i
    }
    const band = WAVE_BANDS[bandIndex]

    return {
      ...spot,
      opacity: 0.62 + spot.depth * 0.38,
      z: Math.round(spot.depth * 100),
      bobDelay: 0, // in phase with the band
      bobDur: band.dur / 3, // same frequency as the band's vertical wave
    }
  }, [item.day_key])

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
        transition={{ duration: 0.55, ease: easeOut }}
      >
      {/* Date pill hovering above */}
      <span className="font-mono text-[9px] text-seafoam/80 bg-ocean-deep/80 border border-seafoam/15 px-1.5 py-0.5 rounded-full whitespace-nowrap mb-1">
        {formatDay(item.day_key)}
      </span>

      {/* Bottle + waterline, bobbing as one unit — amplitude bumped so the
          band-matched frequency reads clearly (a bottle on a fast front band
          visibly wiggles faster than one on a slow back band). */}
      <div
        style={{
          position: 'relative',
          width: W,
          height: H,
          ['--gb-bob' as string]: '-12px',
          ['--gb-rot-a' as string]: `${-7 * layout.drift}deg`,
          ['--gb-rot-b' as string]: `${7 * layout.drift}deg`,
          animation: `gb-sway ${layout.bobDur}s ease-in-out ${layout.bobDelay}s infinite`,
        }}
      >
        <BottleSVG glowing width={W} height={H} look={look} />

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
          <div
            key={r}
            className="absolute left-1/2 pointer-events-none"
            style={{
              bottom: H * 0.12,
              width: W * 0.8,
              height: W * 0.32,
              border: '1px solid rgba(78,205,196,0.35)',
              borderRadius: '50%',
              opacity: 0, // only visible while the ripple plays
              animation: `gb-ripple 3s ease-out ${layout.bobDelay + r * 1.5}s infinite`,
            }}
          />
        ))}
      </div>
      </motion.div>
    </div>
  )
}

// ─── SailingSea ──────────────────────────────────────────────────────────────
// The full artsy sea stage. Layered turbulent waves + distant ships + lightning,
// with the user's undelivered bottles dipped and scattered across the water.
// When a bottle is matched it drops out of `bottles` and floats away.

// memo: the home page re-renders on every status poll; the sea's props
// (a memoized bottle list) rarely change.
export default memo(function SailingSea({
  bottles,
  backdropOnly = false,
  thunder = false,
  theme,
  lighthouse,
}: {
  bottles: SailingBottleItem[]
  /** Keeper lighthouse (Step 10): `glow` 0–1 from months as a Keeper. */
  lighthouse?: { glow: number; lit: boolean }
  /** A current's sea (Keeper + joined current). Omitted = the classic ocean. */
  theme?: SeaTheme
  // Renders only the sky + sea waves (no ships, storm clouds, or bottles).
  backdropOnly?: boolean
  // Freezes a single lightning flash washing the sea (the "thunder instant"):
  // a static peak of the StormClouds internal flash, no cloud blobs/ships/bottles.
  // Intended for still captures.
  thunder?: boolean
}) {
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
            theme?.sky ??
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
            `radial-gradient(80% 100% at 50% 100%, ${theme?.glow ?? 'rgba(78,205,196,0.18)'} 0%, transparent 70%)`,
        }}
      />

      {/* Up to 3 ships on the horizon (~38.5%, where the sky meets the sea).
          topPct marks the waterline; the hull base rests on it. Each crosses
          the whole viewport on X very slowly, sails off one edge and re-enters
          from the opposite side. Mix of left→right and right→left. */}
      {/* Same period (260s, slow) with phases evenly spaced by dur/3 so the
          short off-screen gaps never align — at least one ship is always on the
          sea. */}
      {!backdropOnly && (
        <>
          <Ship topPct={45.5} scale={0.62} opacity={0.6} dur={260} delay={0} dir={1} reduced={reduced} />
          <Ship topPct={45.5} scale={0.72} opacity={0.68} dur={260} delay={87} dir={-1} reduced={reduced} />
          <Ship topPct={45.5} scale={0.82} opacity={0.75} dur={260} delay={173} dir={1} reduced={reduced} />
        </>
      )}

      {!backdropOnly && lighthouse && (
        <Lighthouse glow={lighthouse.glow} lit={lighthouse.lit} reduced={reduced} />
      )}

      {/* Turbulent sea bands */}
      {WAVE_BANDS.map((band, i) => (
        <WaveBand key={i} band={band} reduced={reduced} fill={theme?.bands[i]} foam={theme?.foam} />
      ))}

      {/* Storm clouds throbbing with flash over the scene */}
      {!backdropOnly && <StormClouds reduced={reduced} />}

      {/* Floating bottles dipped in the water */}
      <AnimatePresence>
        {!backdropOnly &&
          bottles.map((b) => (
          // Key by day_key (one bottle per day) so an optimistic placeholder and
          // the real refetched bottle — same day_key — reconcile in place. When a
          // bottle is matched it leaves the list → the exit (fly-up) plays as the
          // "found" vanish.
          <FloatingBottle key={b.day_key} item={b} />
        ))}
      </AnimatePresence>

      {/* Frozen thunder instant — a static peak of the cloud flash washing the
          sea from above. No cloud blobs, ships, or bottles. */}
      {thunder && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(48% 36% at 50% 8%, rgba(206,236,255,0.95) 0%, rgba(120,200,210,0.34) 38%, rgba(78,205,196,0.08) 60%, transparent 78%)',
            mixBlendMode: 'screen',
          }}
        />
      )}

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
})
