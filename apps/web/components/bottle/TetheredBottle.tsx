'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BottleSVG } from './ThrowAnimation'

// ─── TetheredBottle ──────────────────────────────────────────────────────────
// The bottle is tied to the diamond "hook" embossed in the top-right of the
// compose box. The rope drapes OUT over the box's right edge and down the
// OUTSIDE of it — so it never crosses the full-width "Seal & Throw" button — and
// the bottle floats on the open water just off the box's lower-right corner.
// Rope + bottle behave as one pendulum swinging from the hook; the rope is slack
// and bows/whips a beat behind the bottle. On throw the knot lets go: the rope
// snaps back to the hook, the bottle arcs off into the sea with a splash, then
// fires onDropComplete.
//
// Positioned ABSOLUTELY against the box's top-right corner. The parent must be
// `relative` and the same width as the compose box.

const W = 48
const H = 72

// Local coordinate frame of the pendulum container. Origin (0,0) is its
// top-left, which sits CORNER_INSET px to the LEFT of the box's right edge and
// flush with the box top. So: screenX_from_corner = localX − CORNER_INSET.
const CORNER_INSET = 40
const BOX_W = 96
const BOX_H = 270

// The diamond hook (top-3 / right-4, 14×14) → centre 23px left of the corner,
// 19px down → local (17, 19).
const PIVOT_X = 17
const PIVOT_Y = 19

// Where the rope knots onto the bottle: 12px OUTSIDE the right edge, well down
// the side so the bottle floats off the box's lower-right on the water.
const KNOT_X = 52
const KNOT_Y = 168

// Rope path: from the hook, bowed outward (control x) so it crosses the right
// edge high and runs down the OUTSIDE, clear of the button.
const ropePath = (cx: number) => `M${PIVOT_X} ${PIVOT_Y} Q${cx} 86 ${KNOT_X} ${KNOT_Y}`

export default function TetheredBottle({
  dropping,
  onDropComplete,
}: {
  dropping: boolean
  onDropComplete?: () => void
}) {
  const reduced = useReducedMotion() ?? false

  // Slack-rope bow keyframes — leans out/in on its own slightly-shorter period
  // than the pendulum so it visibly trails the bottle.
  const ropeD = [78, 82, 73, 80, 78].map(ropePath)
  const ropeRest = ropePath(78)

  return (
    // Anchor = the box's top-right corner.
    <div className="absolute top-0 right-0 pointer-events-none select-none" style={{ zIndex: 20 }}>
      {/* Pendulum — rope + bottle swing together about the diamond hook. */}
      <motion.div
        className="absolute"
        style={{
          top: 0,
          right: -(BOX_W - CORNER_INSET),
          width: BOX_W,
          height: BOX_H,
          transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px`,
        }}
        initial={false}
        animate={dropping || reduced ? { rotate: 0 } : { rotate: [-2.5, 3, -2, 2.5, -2.5] }}
        transition={
          dropping ? { duration: 0.3 } : { duration: 5.5, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        {/* Rope — slack, braided line draping over the edge. Snaps on throw. */}
        <motion.svg
          className="absolute inset-0"
          width={BOX_W}
          height={BOX_H}
          viewBox={`0 0 ${BOX_W} ${BOX_H}`}
          initial={false}
          animate={dropping ? { opacity: 0 } : { opacity: 1 }}
          transition={{ duration: 0.25, ease: 'easeIn' }}
        >
          {/* core strand */}
          <motion.path
            fill="none"
            stroke="#b07d4f"
            strokeWidth={3}
            strokeLinecap="round"
            initial={false}
            animate={reduced || dropping ? { d: ropeRest } : { d: ropeD }}
            transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* braid overlay — dashed darker strand suggests the twist */}
          <motion.path
            fill="none"
            stroke="#7a5634"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="2 4"
            opacity={0.85}
            initial={false}
            animate={reduced || dropping ? { d: ropeRest } : { d: ropeD }}
            transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.svg>

        {/* Rope loop lashed around the diamond hook */}
        <motion.svg
          className="absolute"
          width={16}
          height={9}
          viewBox="0 0 16 9"
          style={{ left: PIVOT_X - 8, top: PIVOT_Y - 5, zIndex: 21 }}
          initial={false}
          animate={dropping ? { opacity: 0, scale: 0.4 } : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, ease: 'easeIn' }}
        >
          <path d="M3 7 Q8 -2 13 7" stroke="#7a5634" strokeWidth={2.4} fill="none" strokeLinecap="round" />
        </motion.svg>

        {/* Knot where the rope is lashed to the bottle's neck */}
        <motion.div
          className="absolute rounded-full"
          style={{ left: KNOT_X - 6, top: KNOT_Y - 4, width: 12, height: 7, zIndex: 10 }}
          initial={false}
          animate={dropping ? { opacity: 0, scale: 0.4 } : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, ease: 'easeIn' }}
        >
          <div
            className="w-full h-full rounded-full"
            style={{
              background: 'radial-gradient(circle at 50% 35%, #c3946a 0%, #8a5f38 70%, #6e4a2a 100%)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          />
        </motion.div>

        {/* Bottle — outer layer owns the throw arc. Resting position: centred on
            KNOT_X, hanging just below the knot, floating on the water. */}
        <motion.div
          className="absolute"
          style={{ left: KNOT_X - W / 2, top: KNOT_Y + 2, width: W, height: H }}
          initial={false}
          animate={
            dropping
              ? reduced
                ? { opacity: 0 }
                : { x: [0, 18, 48], y: [0, -8, 150], rotate: [0, 24, 92], opacity: [1, 1, 0] }
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
          {/* Inner: tiny secondary buoyancy wobble layered on the pendulum sway */}
          <motion.div
            style={{ transformOrigin: '50% 0%' }}
            animate={
              dropping || reduced ? undefined : { rotate: [-1.5, 2, -1, 1.5, -1.5], y: [0, -2, 0, -2, 0] }
            }
            transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
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
                background: 'linear-gradient(to right, transparent, rgba(78,205,196,0.5), transparent)',
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
            className="absolute"
            style={{ left: KNOT_X - 35, top: KNOT_Y + H + 50, width: 70, height: 26 }}
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
      </motion.div>
    </div>
  )
}
