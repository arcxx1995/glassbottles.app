'use client'

import { motion } from 'framer-motion'
import { useAppSelector } from '@/store'
import { selectSendStatus } from '@/store/bottleSlice'

interface BottleCanvasProps {
  className?: string
  // Bottle width (height keeps the 2:3 aspect). A number is px; a string is used
  // verbatim as a CSS length (e.g. '0.66em' to size the bottle as a glyph that
  // scales with the surrounding font). Defaults to the original 160×240.
  size?: number | string
}

export default function BottleCanvas({ className, size = 160 }: BottleCanvasProps) {
  const sendStatus = useAppSelector(selectSendStatus)
  const isComposing = sendStatus === 'composing'
  const width = typeof size === 'number' ? `${size}px` : size
  const height =
    typeof size === 'number' ? `${size * 1.5}px` : `calc(${size} * 1.5)`

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.88 }}
      transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{ width, height, position: 'relative' }}
      aria-label="Your glass bottle"
    >
      {/* Continuous bob wrapper — separate from enter/exit */}
      <motion.div
        animate={{
          y: [0, -10, 0],
          rotate: [-1.2, 1.2, -1.2],
        }}
        transition={{
          duration: 3.2,
          repeat: Infinity,
          ease: 'easeInOut',
          times: [0, 0.5, 1],
        }}
        style={{ width, height }}
      >
        <svg
          viewBox="0 0 160 240"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width, height }}
        >
          {/* Cork */}
          <rect x="54" y="8" width="52" height="24" rx="8" fill="#C4A882" />
          <rect x="62" y="13" width="36" height="5" rx="2.5" fill="rgba(255,255,255,0.20)" />
          <rect x="62" y="22" width="20" height="3" rx="1.5" fill="rgba(0,0,0,0.10)" />

          {/* Neck */}
          <path
            d="M60 32 L54 66 L106 66 L100 32 Z"
            fill="rgba(255,255,255,0.10)"
            stroke="rgba(255,255,255,0.20)"
            strokeWidth="1.5"
          />
          {/* Neck shine */}
          <path
            d="M62 36 L59 60"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Body outline */}
          <path
            d="M36 66 Q22 98 22 146 Q22 212 80 218 Q138 212 138 146 Q138 98 124 66 Z"
            fill="rgba(255,255,255,0.07)"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="2"
          />

          {/* Primary shine */}
          <path
            d="M40 82 Q34 116 34 146"
            stroke="rgba(255,255,255,0.24)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Secondary shine */}
          <path
            d="M50 72 Q45 90 45 108"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Message scroll */}
          <rect
            x="54"
            y="96"
            width="52"
            height="76"
            rx="5"
            fill="rgba(247,231,206,0.12)"
          />
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1="63"
              y1={112 + i * 14}
              x2="97"
              y2={112 + i * 14}
              stroke="rgba(247,231,206,0.20)"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}

          {/* Seafoam body tint */}
          <path
            d="M36 66 Q22 98 22 146 Q22 212 80 218 Q138 212 138 146 Q138 98 124 66 Z"
            fill="rgba(78,205,196,0.04)"
          />

          {/* Composing glow overlay */}
          {isComposing && (
            <path
              d="M36 66 Q22 98 22 146 Q22 212 80 218 Q138 212 138 146 Q138 98 124 66 Z"
              fill="rgba(78,205,196,0.07)"
              stroke="rgba(78,205,196,0.35)"
              strokeWidth="2"
            />
          )}
        </svg>
      </motion.div>

      {/* Composing pulse ring */}
      {isComposing && (
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: '1.5px solid rgba(78,205,196,0.25)',
            borderRadius: '50%',
          }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.2, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </motion.div>
  )
}
