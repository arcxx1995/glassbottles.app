'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'

// ─── NightSky ────────────────────────────────────────────────────────────────
// A bright night sky layered over the ocean gradient: a slowly spinning galaxy
// blended into the deep-blue sky, a crescent moon, a field of twinkling stars,
// and occasional short-lived shooting stars. Decorative only — fixed, behind the
// page content, and skipped under prefers-reduced-motion.

// Deterministic 0..1 from an integer seed (matches SailingSea's helper) so star
// positions are stable across re-renders and SSR/client hydration.
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const STAR_COUNT = 46

interface Star {
  left: number // %
  top: number // % (kept in the upper sky)
  size: number // px
  baseOpacity: number
  dur: number // twinkle period (s)
  delay: number
}

// ─── Twinkling star field ─────────────────────────────────────────────────────
// Each star pulses opacity + scale on its own clock — the same shimmer pulse the
// idle bottle's halo uses (opacity [low, high, low]), tuned per-star so the field
// flickers instead of breathing in unison.

function StarField({ reduced }: { reduced: boolean }) {
  const stars = useMemo<Star[]>(() => {
    return Array.from({ length: STAR_COUNT }, (_, i): Star => {
      const s = i * 3 + 1
      return {
        left: rand(s) * 100,
        // Bias toward the top ~70% of the sky so stars don't sit on the waves.
        top: rand(s + 1) * 70,
        size: 1 + rand(s + 2) * 2.2,
        baseOpacity: 0.45 + rand(s + 3) * 0.45,
        dur: 2.2 + rand(s + 4) * 3.4,
        delay: rand(s + 5) * 4,
      }
    })
  }, [])

  return (
    <>
      {stars.map((star, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            background: '#F7E7CE',
            boxShadow: `0 0 ${star.size * 2.5}px rgba(247,231,206,0.7)`,
          }}
          initial={{ opacity: star.baseOpacity }}
          animate={
            reduced
              ? { opacity: star.baseOpacity }
              : {
                  opacity: [star.baseOpacity * 0.35, star.baseOpacity, star.baseOpacity * 0.35],
                  scale: [0.85, 1.15, 0.85],
                }
          }
          transition={{
            duration: star.dur,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: star.delay,
          }}
        />
      ))}
    </>
  )
}

// ─── Galaxy ───────────────────────────────────────────────────────────────────
// A NASA-style galaxy fixed high in the sky, tilted in 3/4 view: prismatic nebula
// clouds (teal / violet / magenta / gold / blue) wrapped around a bright core.
// The galaxy itself never grows, shrinks, or spins as a unit — instead the nebula
// clouds inside throb their own lights on independent clocks, and a faint
// highlight revolves within the tilted plane. `screen` blend melts it into sky.

// Prismatic nebula clouds, positioned (%) within the tilted disk. Each pulses its
// own opacity ("throbbing lights") on its own clock — none scale.
// Dense prismatic nebula clumps strung along the galactic band (the diffuse
// Milky-Way sweep). x/y centre the clump in the band box; w/h are % of the box.
// A tight cluster of pink/violet/blue knots = a star-forming region; the rest
// scatter teal / gold / indigo dust down the band. Each throbs its own light.
// Packed close together and heavily blurred so they smear into one smudged,
// cloudy mass rather than reading as separate blobs.
const BAND_NEBULAE = [
  // Dense star-forming cluster.
  { x: 38, y: 50, w: 11, h: 38, color: 'rgba(236,72,153,0.5)', dur: 4.6, delay: 0.0 }, // magenta
  { x: 41, y: 43, w: 9, h: 30, color: 'rgba(167,139,250,0.5)', dur: 5.4, delay: 0.8 }, // violet
  { x: 37, y: 57, w: 9, h: 28, color: 'rgba(96,165,250,0.46)', dur: 6.0, delay: 1.5 }, // blue
  { x: 44, y: 54, w: 8, h: 26, color: 'rgba(244,114,182,0.46)', dur: 5.0, delay: 2.2 }, // pink
  { x: 40, y: 50, w: 6, h: 18, color: 'rgba(255,255,255,0.5)', dur: 4.2, delay: 1.1 }, // bright core knot
  // Scattered dust hugging the band's heart.
  { x: 30, y: 47, w: 12, h: 36, color: 'rgba(78,205,196,0.36)', dur: 6.6, delay: 1.9 }, // teal
  { x: 48, y: 49, w: 11, h: 32, color: 'rgba(251,191,36,0.28)', dur: 7.0, delay: 0.5 }, // gold
  { x: 55, y: 53, w: 12, h: 34, color: 'rgba(99,102,241,0.38)', dur: 6.2, delay: 2.6 }, // indigo
  { x: 62, y: 47, w: 11, h: 32, color: 'rgba(56,189,248,0.36)', dur: 5.8, delay: 1.3 }, // sky
  { x: 68, y: 52, w: 10, h: 28, color: 'rgba(139,92,246,0.32)', dur: 6.8, delay: 3.0 }, // purple
] as const

// Broken dust patches — short, scattered dark wisps that mottle the clouds.
// Deliberately NOT one continuous lane: varied size / angle / position so they
// read as patchy dust gaps. Soft-blurred, static.
const DUST_PATCHES = [
  { x: 34, y: 53, w: 8, h: 5, a: -14, o: 0.5 },
  { x: 43, y: 47, w: 6, h: 4, a: 8, o: 0.42 },
  { x: 49, y: 55, w: 7, h: 4, a: -6, o: 0.46 },
  { x: 57, y: 49, w: 6, h: 5, a: 16, o: 0.44 },
  { x: 63, y: 54, w: 5, h: 3.5, a: -10, o: 0.4 },
  { x: 39, y: 44, w: 5, h: 3.5, a: 4, o: 0.38 },
] as const

function Galaxy({ reduced }: { reduced: boolean }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: '46%',
        top: '30%',
        width: '124vw',
        height: '46vh',
        transform: 'translate(-50%, -50%) rotate(-26deg)',
        mixBlendMode: 'screen',
        opacity: 0.9,
      }}
    >
      {/* Diffuse milky haze, brightest through the band's heart. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(54% 44% at 40% 50%, rgba(200,210,240,0.12) 0%, rgba(130,150,210,0.07) 38%, transparent 72%)',
          filter: 'blur(16px)',
        }}
      />
      {/* Prismatic nebula clouds + star-forming cluster. */}
      {BAND_NEBULAE.map((n, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${n.x}%`,
            top: `${n.y}%`,
            width: `${n.w}%`,
            height: `${n.h}%`,
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(closest-side, ${n.color} 0%, transparent 78%)`,
            filter: 'blur(15px)',
          }}
          animate={reduced ? undefined : { opacity: [0.45, 1, 0.45] }}
          transition={{ duration: n.dur, repeat: Infinity, ease: 'easeInOut', delay: n.delay }}
        />
      ))}

      {/* Broken, patchy dust wisps (not a continuous lane). */}
      {DUST_PATCHES.map((d, i) => (
        <div
          key={`d${i}`}
          className="absolute rounded-full"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: `${d.w}%`,
            height: `${d.h}%`,
            transform: `translate(-50%, -50%) rotate(${d.a}deg)`,
            background: `radial-gradient(closest-side, rgba(6,9,20,${d.o}) 0%, transparent 75%)`,
            filter: 'blur(8px)',
          }}
        />
      ))}
    </div>
  )
}

// ─── Crescent moon ────────────────────────────────────────────────────────────
// A masked circle (a second circle carves the crescent) with a soft outer glow.

function CrescentMoon() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ right: '14%', top: '20%', width: 62, height: 62 }}
    >
      {/* Glow halo */}
      <div
        className="absolute"
        style={{
          inset: -20,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(247,231,206,0.28) 0%, rgba(247,231,206,0.08) 45%, transparent 70%)',
        }}
      />
      <svg viewBox="0 0 100 100" width={62} height={62} style={{ position: 'relative' }}>
        <defs>
          <mask id="moon-crescent">
            <rect width="100" height="100" fill="black" />
            <circle cx="46" cy="50" r="38" fill="white" />
            {/* Shadow circle carves out the crescent */}
            <circle cx="64" cy="42" r="36" fill="black" />
          </mask>
        </defs>
        <circle cx="46" cy="50" r="38" fill="#F7E7CE" mask="url(#moon-crescent)" />
      </svg>
    </div>
  )
}

// ─── Shooting stars ─────────────────────────────────────────────────────────
// A thin tapering streak that fires across a slice of sky, then rests. One
// scheduler drives every streak so only a single shooting star is ever on screen
// at once — each cycle picks one streak, flashes it, then waits a long interval
// before the next.

interface ShootingStarConfig {
  startX: number // vw
  startY: number // vh
  angle: number // deg of travel
  length: number // px of streak body
  distance: number // px travelled
}

const SHOOTING_STARS: ShootingStarConfig[] = [
  { startX: 10, startY: 12, angle: 28, length: 48, distance: 110 },
  { startX: 62, startY: 7, angle: 20, length: 38, distance: 88 },
  { startX: 38, startY: 18, angle: 33, length: 42, distance: 96 },
]

// Long, randomized gap between consecutive shooting stars (ms).
const SHOOT_MIN_GAP = 14000
const SHOOT_MAX_GAP = 30000

function ShootingStarField() {
  // One controls handle per streak. Declared explicitly (not in a loop) to keep
  // the hook call order stable; SHOOTING_STARS has a fixed length of 3.
  const c0 = useAnimationControls()
  const c1 = useAnimationControls()
  const c2 = useAnimationControls()
  const controls = [c0, c1, c2]

  useEffect(() => {
    let active = true
    let last = -1
    async function loop() {
      while (active) {
        const gap = SHOOT_MIN_GAP + Math.random() * (SHOOT_MAX_GAP - SHOOT_MIN_GAP)
        await new Promise((r) => setTimeout(r, gap))
        if (!active) break
        // Pick a streak other than the one that fired last so they alternate.
        let idx = Math.floor(Math.random() * SHOOTING_STARS.length)
        if (idx === last && SHOOTING_STARS.length > 1) {
          idx = (idx + 1) % SHOOTING_STARS.length
        }
        last = idx
        const cfg = SHOOTING_STARS[idx]
        // Travel along the streak's own axis (local x). The rotation lives on the
        // static wrapper, so the trail stays perfectly aligned with its path — a
        // dead-straight line, not a bent one.
        await controls[idx].start({
          x: [0, cfg.distance],
          opacity: [0, 1, 0],
          transition: { duration: 1.3, ease: 'linear', times: [0, 0.3, 1] },
        })
        controls[idx].set({ x: 0, opacity: 0 })
      }
    }
    loop()
    return () => {
      active = false
    }
    // controls identities are stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {SHOOTING_STARS.map((cfg, i) => (
        // Static rotated wrapper sets the path direction; the streak inside only
        // translates along local-x, so motion and trail share one straight axis.
        <div
          key={i}
          className="absolute"
          style={{
            left: `${cfg.startX}vw`,
            top: `${cfg.startY}vh`,
            transform: `rotate(${cfg.angle}deg)`,
            transformOrigin: 'left center',
          }}
        >
          <motion.div
            style={{
              width: cfg.length,
              height: 2,
              borderRadius: 2,
              background:
                'linear-gradient(to left, rgba(247,231,206,0.95), rgba(247,231,206,0.4) 40%, transparent)',
              boxShadow: '0 0 6px rgba(247,231,206,0.8)',
            }}
            initial={{ opacity: 0 }}
            animate={controls[i]}
          />
        </div>
      ))}
    </>
  )
}

// ─── NightSky ──────────────────────────────────────────────────────────────────

export default function NightSky() {
  const reduced = useReducedMotion() ?? false
  // Shooting stars use timers + Math.random — only spin them up after mount to
  // avoid any SSR/hydration divergence.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {/* Bright night-sky wash brightening toward the upper sky, sitting over the
          ocean gradient below it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, #142544 0%, #0E1D38 32%, rgba(10,22,40,0.4) 60%, transparent 80%)',
        }}
      />

      <Galaxy reduced={reduced} />
      <StarField reduced={reduced} />
      <CrescentMoon />

      {!reduced && mounted && <ShootingStarField />}
    </div>
  )
}
