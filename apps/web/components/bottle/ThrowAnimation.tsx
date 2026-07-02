'use client'

import { motion } from 'motion/react'

interface ThrowAnimationProps {
  onComplete: () => void
}

export default function ThrowAnimation({ onComplete }: ThrowAnimationProps) {
  return (
    <div
      style={{ position: 'relative', width: '100%', height: '320px' }}
      aria-label="Throwing your bottle into the ocean"
      aria-live="polite"
    >
      {/* Bottle arc */}
      <motion.div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          marginLeft: '-40px',
          marginTop: '-60px',
          width: '80px',
          height: '120px',
        }}
        animate={{
          x: [0, 60, 200],
          y: [0, -120, 40],
          rotate: [0, 12, 42],
          opacity: [1, 1, 0],
        }}
        transition={{
          duration: 0.85,
          times: [0, 0.55, 1],
          // Parabolic arc: constant horizontal travel, vertical rises fast then
          // falls under gravity. One shared ease flattened it into a diagonal slide.
          x: { ease: 'linear' },
          y: { ease: ['easeOut', 'easeIn'] },
          rotate: { ease: 'linear' },
          opacity: { ease: 'easeIn' },
        }}
        onAnimationComplete={onComplete}
      >
        <BottleSVG glowing />
      </motion.div>

      {/* Ripple on landing */}
      <motion.div
        style={{
          position: 'absolute',
          right: '25%',
          bottom: '20%',
          width: '48px',
          height: '24px',
        }}
        initial={{ opacity: 0, scaleX: 0, scaleY: 0 }}
        animate={{ opacity: [0, 0.5, 0], scaleX: [0, 1, 1.4], scaleY: [0, 1, 0.3] }}
        transition={{ duration: 0.5, delay: 0.72, ease: 'easeOut' }}
      >
        <svg viewBox="0 0 48 24" fill="none" style={{ width: '48px', height: '24px' }}>
          <ellipse cx="24" cy="12" rx="22" ry="10" stroke="#4ECDC4" strokeWidth="1.5" opacity="0.6" />
          <ellipse cx="24" cy="12" rx="14" ry="6" stroke="#4ECDC4" strokeWidth="1" opacity="0.35" />
        </svg>
      </motion.div>

      {/* Status text */}
      <motion.p
        className="absolute bottom-8 left-0 right-0 text-center font-ui text-sm text-sand/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        Casting into the ocean…
      </motion.p>
    </div>
  )
}

// ─── Shared bottle SVG ───────────────────────────────────────────────────────

interface BottleSVGProps {
  glowing?: boolean
  width?: number
  height?: number
}

export function BottleSVG({
  glowing = false,
  width = 80,
  height = 120,
}: BottleSVGProps) {
  return (
    <svg
      viewBox="0 0 80 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        width,
        height,
        filter: glowing
          ? 'drop-shadow(0 0 10px rgba(78,205,196,0.55))'
          : undefined,
      }}
    >
      {/* Cork */}
      <rect x="27" y="3" width="26" height="13" rx="4" fill="#C4A882" />
      <rect x="32" y="6" width="16" height="3" rx="1.5" fill="rgba(255,255,255,0.18)" />

      {/* Neck */}
      <path
        d="M30 16 L27 34 L53 34 L50 16 Z"
        fill="rgba(255,255,255,0.10)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
      />

      {/* Body */}
      <path
        d="M19 34 Q11 52 11 72 Q11 104 40 108 Q69 104 69 72 Q69 52 61 34 Z"
        fill="rgba(255,255,255,0.07)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
      />

      {/* Shine / refraction */}
      <path
        d="M20 42 Q17 58 17 72"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M26 36 Q23 46 23 56"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Message scroll */}
      <rect x="28" y="52" width="24" height="32" rx="3" fill="rgba(247,231,206,0.13)" />
      <line x1="33" y1="62" x2="47" y2="62" stroke="rgba(247,231,206,0.22)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="33" y1="68" x2="47" y2="68" stroke="rgba(247,231,206,0.22)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="33" y1="74" x2="42" y2="74" stroke="rgba(247,231,206,0.22)" strokeWidth="1.5" strokeLinecap="round" />

      {/* Seafoam tint */}
      <path
        d="M19 34 Q11 52 11 72 Q11 104 40 108 Q69 104 69 72 Q69 52 61 34 Z"
        fill="rgba(78,205,196,0.04)"
      />
    </svg>
  )
}
