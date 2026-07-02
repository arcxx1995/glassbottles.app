'use client'

import { useEffect } from 'react'
import { motion } from 'motion/react'

interface AppErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    // Log to error reporting service in production
    console.error('[AppError]', error.message, error.digest)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-5 text-center">
      <motion.span
        className="text-5xl select-none"
        animate={{ rotate: [-6, 6, -6] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        role="img"
        aria-label="glass bottle"
      >
        🫙
      </motion.span>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl text-sand">Rough waters</h2>
        <p className="font-ui text-sm text-sand/40 max-w-[240px] mx-auto leading-relaxed">
          Something broke on our end. The ocean is unpredictable.
        </p>
        {error.digest && (
          <p className="font-mono text-[10px] text-sand/20 mt-1">
            ref: {error.digest}
          </p>
        )}
      </div>

      <button
        onClick={reset}
        className="px-8 py-3.5 rounded-2xl bg-seafoam/10 text-seafoam font-ui text-sm
                   font-medium hover:bg-seafoam/20 transition-colors active:scale-[0.97]"
      >
        Try again
      </button>
    </div>
  )
}
