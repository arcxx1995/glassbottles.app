'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BottleSVG } from './ThrowAnimation'

// ─── ScreenBottle ────────────────────────────────────────────────────────────
// A small bottle pinned to the TOP-RIGHT of the screen (outside the chatbox). It
// wiggles gently with a shimmer halo around it. On throw it vanishes (fade +
// shrink) and the thrown bottle re-appears at a random spot on the sea.

const W = 52
const H = 78
const REST_SCALE = 0.64

export default function TetheredBottle({
  dropping,
  onDropComplete,
}: {
  dropping: boolean
  onDropComplete?: () => void
}) {
  const reduced = useReducedMotion() ?? false

  return (
    <div className="fixed top-3 right-4 z-50 pointer-events-none select-none">
      <motion.div
        className="relative"
        style={{ width: W, height: H, transformOrigin: '50% 50%' }}
        initial={false}
        animate={
          dropping
            ? { opacity: 0, scale: REST_SCALE * 0.6, y: -10 }
            : { opacity: 1, scale: REST_SCALE }
        }
        transition={{
          duration: dropping ? 0.35 : 0.4,
          ease: dropping ? 'easeIn' : 'easeOut',
        }}
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
              animate={dropping ? undefined : { opacity: [0.35, 0.75, 0.35], scale: [0.85, 1.15, 0.85] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
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
