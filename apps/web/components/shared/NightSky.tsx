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
// A soft elliptical nebula that drifts through a slow full rotation. Built from
// overlapping radial gradients (a bright core + two swept arms) tinted seafoam /
// violet / sand, kept low-alpha with `screen` blend so it melts into the sky
// rather than sitting on top of it.

function Galaxy({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        left: '14%',
        top: '20%',
        width: '46vw',
        height: '46vw',
        maxWidth: 620,
        maxHeight: 620,
        transform: 'translate(-50%, -50%)',
        mixBlendMode: 'screen',
        opacity: 0.55,
      }}
      animate={reduced ? undefined : { rotate: 360 }}
      transition={{ duration: 150, repeat: Infinity, ease: 'linear' }}
    >
      {/* Swept arms — two offset elongated gradients give a faint spiral read. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(60% 30% at 50% 50%, rgba(78,205,196,0.28) 0%, rgba(108,91,221,0.14) 42%, transparent 70%)',
          transform: 'rotate(24deg)',
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(58% 26% at 50% 50%, rgba(247,231,206,0.16) 0%, rgba(78,205,196,0.10) 46%, transparent 72%)',
          transform: 'rotate(-58deg)',
        }}
      />
      {/* Bright core */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(22% 22% at 50% 50%, rgba(255,255,255,0.4) 0%, rgba(247,231,206,0.18) 35%, transparent 60%)',
        }}
      />
    </motion.div>
  )
}

// ─── Crescent moon ────────────────────────────────────────────────────────────
// A masked circle (a second circle carves the crescent) with a soft outer glow.

function CrescentMoon() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ right: '14%', top: '12%', width: 88, height: 88 }}
    >
      {/* Glow halo */}
      <div
        className="absolute"
        style={{
          inset: -28,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(247,231,206,0.28) 0%, rgba(247,231,206,0.08) 45%, transparent 70%)',
        }}
      />
      <svg viewBox="0 0 100 100" width={88} height={88} style={{ position: 'relative' }}>
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

// ─── Shooting star ────────────────────────────────────────────────────────────
// A thin tapering streak that fires across a slice of sky at randomized
// intervals, then rests. Two instances run on different paths / clocks so the sky
// has only an occasional, short-lived flash rather than a steady stream.

interface ShootingStarConfig {
  startX: number // vw
  startY: number // vh
  angle: number // deg of travel
  length: number // px of streak body
  distance: number // px travelled
  minWait: number
  maxWait: number
}

function ShootingStar({ config }: { config: ShootingStarConfig }) {
  const controls = useAnimationControls()
  const dx = Math.cos((config.angle * Math.PI) / 180) * config.distance
  const dy = Math.sin((config.angle * Math.PI) / 180) * config.distance

  useEffect(() => {
    let active = true
    async function loop() {
      while (active) {
        const wait = config.minWait + Math.random() * (config.maxWait - config.minWait)
        await new Promise((r) => setTimeout(r, wait))
        if (!active) break
        await controls.start({
          x: [0, dx],
          y: [0, dy],
          opacity: [0, 1, 1, 0],
          transition: { duration: 0.85, ease: 'easeIn', times: [0, 0.15, 0.7, 1] },
        })
        controls.set({ x: 0, y: 0, opacity: 0 })
      }
    }
    loop()
    return () => {
      active = false
    }
  }, [controls, dx, dy, config])

  return (
    <motion.div
      className="absolute"
      style={{
        left: `${config.startX}vw`,
        top: `${config.startY}vh`,
        width: config.length,
        height: 2,
        borderRadius: 2,
        transform: `rotate(${config.angle}deg)`,
        transformOrigin: 'left center',
        background:
          'linear-gradient(to left, rgba(247,231,206,0.95), rgba(247,231,206,0.4) 40%, transparent)',
        boxShadow: '0 0 6px rgba(247,231,206,0.8)',
      }}
      initial={{ opacity: 0 }}
      animate={controls}
    />
  )
}

const SHOOTING_STARS: ShootingStarConfig[] = [
  { startX: 8, startY: 12, angle: 28, length: 120, distance: 460, minWait: 6000, maxWait: 13000 },
  { startX: 62, startY: 6, angle: 20, length: 90, distance: 380, minWait: 9000, maxWait: 18000 },
]

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

      {!reduced &&
        mounted &&
        SHOOTING_STARS.map((config, i) => <ShootingStar key={i} config={config} />)}
    </div>
  )
}
