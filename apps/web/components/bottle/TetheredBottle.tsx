'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BottleSVG } from './ThrowAnimation'
import { computeSeaSpot } from './SailingSea'

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
}: {
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
        <motion.div
          className="relative"
          style={{ width: W, height: H, transformOrigin: '50% 80%' }}
          animate={dropping || reduced ? undefined : { rotate: [-6, 6, -6], y: [0, -3, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          {/* Shimmer halo — centered exactly on the bottle, behind it. */}
          {!reduced && (
            <motion.div
              className="absolute left-1/2 top-1/2 rounded-full"
              // Centre via negative margins, NOT transform: this element animates
              // `scale`, and framer-motion writes `transform` from its animated
              // values — a `transform: translate(...)` here would be clobbered,
              // shoving the halo off the bottle. Margins keep it dead-centre while
              // scale grows about its own centre.
              style={{
                width: W * 1.7,
                height: W * 1.7,
                marginLeft: -(W * 1.7) / 2,
                marginTop: -(W * 1.7) / 2,
                background:
                  'radial-gradient(circle, rgba(78,205,196,0.40) 0%, rgba(78,205,196,0.12) 45%, transparent 70%)',
              }}
              animate={dropping ? { opacity: 0 } : { opacity: [0.35, 0.75, 0.35], scale: [0.85, 1.15, 0.85] }}
              transition={
                dropping
                  ? { duration: 0.2, ease: 'easeOut' }
                  : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }
              }
            />
          )}

          <BottleSVG glowing width={W} height={H} />

          {/* Travelling neon glow that runs clockwise around the bottle's edge.
              A short bright seafoam dash sweeps along the silhouette path. Stops
              (animate=undefined) on throw so it fades out with the bottle. */}
          {!reduced && (
            <svg
              viewBox="0 0 80 120"
              fill="none"
              className="absolute inset-0 pointer-events-none"
              style={{ width: W, height: H, filter: 'drop-shadow(0 0 5px rgba(78,205,196,0.95))' }}
            >
              <motion.path
                d="M28 4 L28 15 L30 16 L27 34 L19 34 Q11 52 11 72 Q11 104 40 108 Q69 104 69 72 Q69 52 61 34 L53 34 L50 16 L52 15 L52 4 Z"
                stroke="#7CFFE6"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray="0.35 0.65"
                animate={dropping ? undefined : { strokeDashoffset: [0, -1] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
              />
            </svg>
          )}
        </motion.div>
      </motion.div>
    </div>
  )
}
