'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BottleSVG } from './ThrowAnimation'
import { computeSeaSpot } from './SailingSea'
import type { BottleLook } from '@/lib/dressing'

// ─── ScreenBottle ────────────────────────────────────────────────────────────
// A small bottle pinned to the TOP-RIGHT of the screen (outside the chatbox). It
// wiggles gently with a shimmer halo around it. On throw it arcs across the
// screen — wind-up, launch, tumbling flight — and splashes down at the EXACT
// spot where the optimistic FloatingBottle (same day_key hash) will surface,
// so the hand-off reads as one continuous object.

const W = 52
const H = 78
const REST_SCALE = 0.64
const THROW_DURATION = 1.15

interface ThrowPath {
  dx: number
  dy: number
  scale: number
}

export default function TetheredBottle({
  dropping,
  landingDayKey,
  onDropComplete,
  look,
}: {
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

  // Measure the flight vector the moment the throw starts — before paint, so
  // the arc's first frame already knows its destination.
  useLayoutEffect(() => {
    if (!dropping || reduced) {
      setPath(null)
      return
    }
    const rect = anchorRef.current?.getBoundingClientRect()
    const spot = landingDayKey
      ? computeSeaSpot(landingDayKey)
      : { left: 42, top: 70, scale: 0.85 }
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth - 42
    const cy = rect ? rect.top + rect.height / 2 : 60
    setPath({
      dx: (spot.left / 100) * window.innerWidth - cx,
      dy: (spot.top / 100) * window.innerHeight - cy,
      scale: spot.scale,
    })
  }, [dropping, reduced, landingDayKey])

  // Tumble direction follows horizontal travel (throwing left → counter-clockwise).
  const dir = path && path.dx > 0 ? 1 : -1
  const throwing = dropping && !reduced && path !== null

  return (
    <div
      ref={anchorRef}
      className="fixed right-4 z-50 pointer-events-none select-none"
      style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
    >
      <motion.div
        className="relative"
        style={{ width: W, height: H, transformOrigin: '50% 50%' }}
        initial={false}
        animate={
          throwing
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
          throwing
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
        {/* Wiggling bottle — with the shimmer halo locked directly behind it so it
            tracks the wiggle and fades out together on throw. */}
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
    </div>
  )
}
