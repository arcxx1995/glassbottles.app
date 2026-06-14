'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BottleSVG } from './ThrowAnimation'

// ─── BoxBottle ───────────────────────────────────────────────────────────────
// A small bottle tucked into the TOP-RIGHT of the compose box. On throw it simply
// vanishes (fades + shrinks) — the chatbox disappears at the same time, and the
// thrown bottle re-appears at a random spot on the sea (SailingSea handles that).
// No rope, no fall, no fixed landing.

const W = 52
const H = 78
const REST_SCALE = 0.58

export default function TetheredBottle({
  dropping,
  onDropComplete,
}: {
  dropping: boolean
  onDropComplete?: () => void
}) {
  const reduced = useReducedMotion() ?? false

  return (
    // Anchor = the compose box's top-right corner. Parent must be `relative`.
    <div className="absolute top-0 right-0 pointer-events-none select-none" style={{ zIndex: 20 }}>
      <motion.div
        className="absolute"
        style={{ top: 6, right: 8, width: W, height: H, transformOrigin: '50% 50%' }}
        initial={false}
        animate={
          dropping
            ? { opacity: 0, scale: REST_SCALE * 0.7, y: -6 }
            : { opacity: 1, scale: REST_SCALE, y: 0 }
        }
        transition={{
          duration: dropping ? 0.35 : 0.4,
          ease: dropping ? 'easeIn' : 'easeOut',
        }}
        onAnimationComplete={() => {
          if (dropping) onDropComplete?.()
        }}
      >
        {/* Gentle idle float while it waits in the box. */}
        <motion.div
          style={{ transformOrigin: '50% 50%' }}
          animate={dropping || reduced ? undefined : { y: [0, -3, 0], rotate: [-3, 3, -3] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <BottleSVG glowing width={W} height={H} />
        </motion.div>
      </motion.div>
    </div>
  )
}
