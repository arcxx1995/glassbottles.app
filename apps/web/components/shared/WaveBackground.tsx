'use client'

import { motion } from 'motion/react'

const WAVE_LAYERS = [
  { speed: 8, offset: 0, opacity: 0.14, bottom: 0 },
  { speed: 11, offset: 1.5, opacity: 0.09, bottom: 20 },
  { speed: 14, offset: 3.0, opacity: 0.06, bottom: 40 },
] as const

export default function WaveBackground() {
  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      aria-hidden="true"
    >
      {/* Gradient base */}
      <div className="absolute inset-0 bg-gradient-to-b from-ocean-deep via-[#0C1C2E] to-[#091520]" />

      {/* Ambient radial glow */}
      <motion.div
        className="absolute rounded-full"
        style={{
          top: '-10%',
          left: '20%',
          width: '60vw',
          height: '60vw',
          background:
            'radial-gradient(circle, rgba(78,205,196,0.05) 0%, transparent 65%)',
        }}
        animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Animated wave layers */}
      {WAVE_LAYERS.map((layer, i) => (
        <motion.div
          key={i}
          className="absolute left-0"
          style={{
            bottom: layer.bottom,
            width: '200%',
            height: '80px',
            opacity: layer.opacity,
            willChange: 'transform',
          }}
          animate={{ x: ['0%', '-50%'] }}
          transition={{
            duration: layer.speed,
            repeat: Infinity,
            ease: 'linear',
            delay: layer.offset,
          }}
        >
          <svg
            viewBox="0 0 1440 80"
            preserveAspectRatio="none"
            style={{ width: '100%', height: '80px' }}
          >
            <path
              d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,80 L0,80 Z"
              fill="#4ECDC4"
            />
          </svg>
        </motion.div>
      ))}

      {/* Bottom solid ocean fill */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: '48px', background: 'rgba(78,205,196,0.04)' }}
      />
    </div>
  )
}
