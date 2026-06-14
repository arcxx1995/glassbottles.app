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
    <div className="fixed top-6 right-5 z-30 pointer-events-none select-none">
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
        {/* Shimmer halo — soft pulsing glow behind the bottle. */}
        {!reduced && !dropping && (
          <motion.div
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: W * 1.7,
              height: W * 1.7,
              transform: 'translate(-50%, -50%)',
              background:
                'radial-gradient(circle, rgba(78,205,196,0.40) 0%, rgba(78,205,196,0.12) 45%, transparent 70%)',
            }}
            animate={{ opacity: [0.35, 0.75, 0.35], scale: [0.85, 1.15, 0.85] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Twinkling shimmer specks around the bottle. */}
        {!reduced &&
          !dropping &&
          [
            { x: '6%', y: '12%', d: 0 },
            { x: '88%', y: '30%', d: 0.8 },
            { x: '20%', y: '82%', d: 1.5 },
          ].map((s, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{
                left: s.x,
                top: s.y,
                width: 3,
                height: 3,
                background: 'rgba(206,236,255,0.95)',
                boxShadow: '0 0 6px rgba(78,205,196,0.9)',
              }}
              animate={{ opacity: [0, 1, 0], scale: [0.4, 1.2, 0.4] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: s.d }}
            />
          ))}

        {/* Wiggling bottle. */}
        <motion.div
          className="relative"
          style={{ transformOrigin: '50% 80%' }}
          animate={dropping || reduced ? undefined : { rotate: [-6, 6, -6], y: [0, -3, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <BottleSVG glowing width={W} height={H} />
        </motion.div>
      </motion.div>
    </div>
  )
}
