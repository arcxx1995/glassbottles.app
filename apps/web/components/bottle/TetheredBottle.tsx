'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  useVelocity,
} from 'motion/react'
import { BottleSVG } from './ThrowAnimation'
import { computeSeaSpot } from './SailingSea'
import type { BottleLook } from '@/lib/dressing'
import { feel } from '@/lib/feel'
import { project, springFlick } from '@/components/ui/springs'

// ─── ScreenBottle ────────────────────────────────────────────────────────────
// A small bottle pinned to the TOP-RIGHT of the screen (outside the chatbox). It
// wiggles gently with a shimmer halo around it. On throw it arcs across the
// screen — wind-up, launch, tumbling flight — and splashes down at the EXACT
// spot where the optimistic FloatingBottle (same day_key hash) will surface,
// so the hand-off reads as one continuous object.
//
// It can also be thrown by hand (when `onFlick` is set): grab it, it follows
// the finger from where it was grabbed and leans into the motion. Let go
// moving toward the sea with enough momentum (the release velocity projected
// forward covers a third of the way) and it flies from exactly where it is,
// at the speed it was thrown, on independent X/Y springs. A timid flick
// springs home. The Seal & Throw button stays the accessible path.

const W = 52
const H = 78
const REST_SCALE = 0.64
const THROW_DURATION = 1.15

interface ThrowPath {
  dx: number
  dy: number
  scale: number
}

interface Flick {
  vx: number
  vy: number
  /** Flight time, shorter for a harder throw. */
  t: number
}

export default function TetheredBottle({
  dropping,
  landingDayKey,
  onDropComplete,
  onFlick,
  look,
}: {
  /** Set while a hand throw is allowed (message ready, idle). Called on commit. */
  onFlick?: () => void
  /** The draft's Atelier dressing — you throw the bottle you dressed. */
  look?: BottleLook
  dropping: boolean
  // day_key of the bottle being thrown — seeds the landing spot.
  landingDayKey?: string
  onDropComplete?: () => void
}) {
  const reduced = useReducedMotion() ?? false
  const anchorRef = useRef<HTMLDivElement>(null)
  const [path, setPath] = useState<ThrowPath | null>(null)
  const [flick, setFlick] = useState<Flick | null>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  // Lean into the drag: horizontal speed tilts the bottle, like a real hand.
  const lean = useTransform(useVelocity(x), [-1500, 0, 1500], [-24, 0, 24], { clamp: true })

  function measure(): ThrowPath {
    const rect = anchorRef.current?.getBoundingClientRect()
    const spot = landingDayKey
      ? computeSeaSpot(landingDayKey)
      : { left: 42, top: 70, scale: 0.85 }
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth - 42
    const cy = rect ? rect.top + rect.height / 2 : 60
    return {
      dx: (spot.left / 100) * window.innerWidth - cx,
      dy: (spot.top / 100) * window.innerHeight - cy,
      scale: spot.scale,
    }
  }

  // Measure the flight vector the moment the throw starts — before paint, so
  // the arc's first frame already knows its destination.
  useLayoutEffect(() => {
    if (!dropping || reduced) {
      setPath(null)
      setFlick(null)
      return
    }
    setPath(measure())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measure reads refs + landingDayKey
  }, [dropping, reduced, landingDayKey])

  function release(vx: number, vy: number) {
    const p = measure()
    const len = Math.hypot(p.dx, p.dy) || 1
    const ux = p.dx / len
    const uy = p.dy / len
    const speed = vx * ux + vy * uy // toward the landing spot
    const rest = (x.get() + project(vx)) * ux + (y.get() + project(vy)) * uy
    if (onFlick && speed > 150 && rest > len / 3) {
      setFlick({ vx, vy, t: Math.min(1.3, Math.max(0.75, 1.3 - speed / 4000)) })
      feel('tick')
      onFlick()
    } else {
      animate(x, 0, { ...springFlick, velocity: vx })
      animate(y, 0, { ...springFlick, velocity: vy })
    }
  }

  // Tumble direction follows horizontal travel (throwing left → counter-clockwise).
  const dir = path && path.dx > 0 ? 1 : -1
  const throwing = dropping && !reduced && path !== null
  const grabbable = !!onFlick && !dropping && !reduced

  return (
    <div
      ref={anchorRef}
      className="fixed right-4 z-50 pointer-events-none select-none"
      style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
    >
      <motion.div
        className={grabbable ? 'relative pointer-events-auto cursor-grab active:cursor-grabbing' : 'relative'}
        style={{ width: W, height: H, transformOrigin: '50% 50%', x, y }}
        initial={false}
        drag={grabbable}
        dragMomentum={false}
        onDragEnd={(_, info) => release(info.velocity.x, info.velocity.y)}
        whileDrag={{ scale: REST_SCALE * 1.12 }}
        animate={
          throwing && flick
            ? // Thrown by hand: carry on from the release point toward the spot.
              { x: path.dx, y: path.dy, rotate: 118 * dir, scale: path.scale, opacity: [1, 1, 0] }
            : throwing
            ? {
                // Wind-up (0→22%): pull back against the travel direction and
                // lift — a throw starts by moving away from the target.
                // Flight (22→100%): x flies out near-linearly; y rises to an
                // apex then falls under gravity; rotation tumbles with
                // increasing angular velocity; scale settles into the spot's
                // scene depth; opacity dunks out in the last beat (the splash).
                x: [0, -path.dx * 0.06, path.dx * 0.5, path.dx],
                y: [0, -14, -70, path.dy],
                rotate: [0, -14 * dir, 32 * dir, 118 * dir],
                scale: [REST_SCALE, REST_SCALE * 1.06, (REST_SCALE + path.scale) / 2, path.scale],
                opacity: [1, 1, 1, 0],
              }
            : dropping
              ? { opacity: 0, scale: REST_SCALE * 0.6, y: -10 }
              : { opacity: 1, scale: REST_SCALE, x: 0, y: 0, rotate: 0 }
        }
        transition={
          throwing && flick
            ? {
                // Independent X/Y springs seeded with the finger's velocity:
                // no seam between the hand and the flight.
                x: { type: 'spring', bounce: 0, visualDuration: flick.t, velocity: flick.vx },
                y: { type: 'spring', bounce: 0, visualDuration: flick.t, velocity: flick.vy },
                rotate: { duration: flick.t, ease: 'easeIn' },
                scale: { duration: flick.t, ease: 'easeInOut' },
                opacity: { duration: flick.t, times: [0, 0.85, 1], ease: 'easeIn' },
              }
            : throwing
            ? {
                duration: THROW_DURATION,
                times: [0, 0.22, 0.58, 1],
                x: { ease: ['easeInOut', 'easeIn', 'linear'] },
                y: { ease: ['easeInOut', 'easeOut', 'easeIn'] },
                rotate: { ease: ['easeInOut', 'easeIn', 'linear'] },
                scale: { ease: 'easeInOut' },
                opacity: { times: [0, 0.22, 0.9, 1], ease: 'easeIn' },
              }
            : {
                duration: dropping ? 0.35 : 0.4,
                ease: dropping ? 'easeIn' : 'easeOut',
              }
        }
        onAnimationComplete={() => {
          if (dropping) onDropComplete?.()
        }}
      >
        <motion.div style={{ rotate: lean }}>
        {/* Wiggling bottle — with the shimmer halo locked directly behind it so it
            tracks the wiggle and fades out together on throw. The idle loops are
            CSS keyframes (globals.css): compositor-only, no per-frame JS. */}
        <div
          className="relative"
          style={{
            width: W,
            height: H,
            transformOrigin: '50% 80%',
            ['--gb-bob' as string]: '-3px',
            ['--gb-rot-a' as string]: '-6deg',
            ['--gb-rot-b' as string]: '6deg',
            animation: dropping || reduced ? undefined : 'gb-sway 2.2s ease-in-out infinite',
          }}
        >
          {/* Shimmer halo — centered exactly on the bottle, behind it. The
              motion wrapper only fades it out on throw; the pulse is CSS. */}
          {!reduced && (
            <motion.div
              className="absolute left-1/2 top-1/2"
              style={{
                width: W * 1.7,
                height: W * 1.7,
                marginLeft: -(W * 1.7) / 2,
                marginTop: -(W * 1.7) / 2,
              }}
              animate={{ opacity: dropping ? 0 : 1 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div
                className="h-full w-full rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(78,205,196,0.40) 0%, rgba(78,205,196,0.12) 45%, transparent 70%)',
                  ['--gb-scale-a' as string]: 0.85,
                  ['--gb-scale-b' as string]: 1.15,
                  ['--gb-op-a' as string]: 0.35,
                  ['--gb-op-b' as string]: 0.75,
                  animation: 'gb-pulse 2.6s ease-in-out infinite',
                }}
              />
            </motion.div>
          )}

          <BottleSVG glowing width={W} height={H} look={look} />

          {/* Travelling neon glow that runs clockwise around the bottle's edge:
              a short bright dash sweeping the silhouette, over a wider faint
              copy of itself for the bloom. That copy replaces a drop-shadow
              filter, which re-rasterized every frame of the dash animation. */}
          {!reduced && !dropping && (
            <svg
              viewBox="0 0 80 120"
              fill="none"
              className="absolute inset-0 pointer-events-none"
              style={{ width: W, height: H }}
            >
              {[
                { w: 7, c: 'rgba(78,205,196,0.35)' },
                { w: 2.5, c: '#7CFFE6' },
              ].map(({ w, c }) => (
                <path
                  key={w}
                  d="M28 4 L28 15 L30 16 L27 34 L19 34 Q11 52 11 72 Q11 104 40 108 Q69 104 69 72 Q69 52 61 34 L53 34 L50 16 L52 15 L52 4 Z"
                  stroke={c}
                  strokeWidth={w}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray="0.35 0.65"
                  style={{ animation: 'gb-dash 2.6s linear infinite' }}
                />
              ))}
            </svg>
          )}
        </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
