'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BottleSVG } from './ThrowAnimation'

// ─── TetheredBottle ──────────────────────────────────────────────────────────
// The pier is gone. The bottle now floats directly on the SailingSea water,
// hung from the compose box above it by a short rope so it reads as "tied" to
// the message you're writing. It wobbles/bobs while idle; on throw the rope
// snaps, the bottle arcs off into the sea with a splash, then fires
// onDropComplete for the handover to the sailing scene.

const W = 48
const H = 72

export default function TetheredBottle({
  dropping,
  onDropComplete,
}: {
  dropping: boolean
  onDropComplete?: () => void
}) {
  const reduced = useReducedMotion() ?? false

  return (
    <div className="relative flex flex-col items-center pointer-events-none select-none mt-2">
      {/* Rope tying the bottle to the chatbox above. Snaps away on throw. */}
      <motion.div
        style={{ width: 2, height: 44, transformOrigin: '50% 0%' }}
        initial={false}
        animate={dropping ? { opacity: 0, scaleY: 0 } : { opacity: 1, scaleY: 1 }}
        transition={{ duration: 0.3, ease: 'easeIn' }}
      >
        <div
          className="w-full h-full"
          style={{
            background:
              'repeating-linear-gradient(to bottom, rgba(195,148,106,0.85) 0 3px, rgba(120,86,52,0.85) 3px 7px)',
            borderRadius: 2,
          }}
        />
      </motion.div>

      {/* Bottle on the water — outer layer owns the throw arc */}
      <motion.div
        className="relative"
        style={{ width: W, height: H }}
        initial={false}
        animate={
          dropping
            ? reduced
              ? { opacity: 0 }
              : { x: [0, 16, 40], y: [0, -10, 140], rotate: [0, 24, 88], opacity: [1, 1, 0] }
            : { opacity: 1 }
        }
        transition={
          dropping
            ? reduced
              ? { duration: 0.3 }
              : { duration: 0.85, ease: [0.4, 0, 0.7, 1], times: [0, 0.35, 1] }
            : { duration: 0.5 }
        }
        onAnimationComplete={() => {
          if (dropping) onDropComplete?.()
        }}
      >
        {/* Inner: gentle wobble + bob while tied to the rope */}
        <motion.div
          style={{ transformOrigin: '50% 100%' }}
          animate={
            dropping || reduced
              ? undefined
              : { rotate: [-5, 6, -4, 5, -5], x: [0, 1.5, -1.5, 1, 0], y: [0, -3, 0, -3, 0] }
          }
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
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
                'linear-gradient(to bottom, rgba(11,32,53,0) 0%, rgba(9,26,43,0.82) 45%, rgba(7,20,31,0.96) 100%)',
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
        </motion.div>

        {/* Expanding ripple rings at the waterline */}
        {!reduced &&
          !dropping &&
          [0, 1].map((r) => (
            <motion.div
              key={r}
              className="absolute left-1/2 pointer-events-none"
              style={{
                bottom: H * 0.1,
                width: W * 0.8,
                height: W * 0.32,
                transform: 'translateX(-50%)',
                border: '1px solid rgba(78,205,196,0.35)',
                borderRadius: '50%',
              }}
              animate={{ scale: [0.5, 1.4], opacity: [0.5, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeOut', delay: r * 1.5 }}
            />
          ))}
      </motion.div>

      {/* Splash where the bottle hits the water on drop */}
      {dropping && !reduced && (
        <motion.div
          className="absolute left-1/2"
          style={{ bottom: -30, width: 70, height: 26, transform: 'translateX(-50%)' }}
          initial={{ opacity: 0, scale: 0.2 }}
          animate={{ opacity: [0, 0.7, 0], scale: [0.2, 1.3, 1.7] }}
          transition={{ duration: 0.6, delay: 0.5, ease: 'easeOut' }}
        >
          <svg viewBox="0 0 70 26" fill="none" style={{ width: '100%', height: '100%' }}>
            <ellipse cx={35} cy={13} rx={32} ry={10} stroke="#4ECDC4" strokeOpacity={0.6} strokeWidth={2} />
            <ellipse cx={35} cy={13} rx={20} ry={6} stroke="#4ECDC4" strokeOpacity={0.35} strokeWidth={1.5} />
          </svg>
        </motion.div>
      )}
    </div>
  )
}
