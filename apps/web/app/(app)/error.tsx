'use client'

import { useEffect } from 'react'
import { BottleSVG } from '@/components/bottle/ThrowAnimation'

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
    <div className="flex flex-col items-center justify-center min-h-[100svh] gap-6 px-5 text-center">
      {/* The app's own bottle rocking on rough water (CSS loop, compositor-only). */}
      <span
        className="select-none"
        role="img"
        aria-label="glass bottle"
        style={{
          transformOrigin: '50% 80%',
          ['--gb-rot-a' as string]: '-8deg',
          ['--gb-rot-b' as string]: '8deg',
          ['--gb-bob' as string]: '-4px',
          animation: 'gb-sway 2.4s ease-in-out infinite',
          display: 'inline-block',
        }}
      >
        <BottleSVG width={48} height={72} glowing />
      </span>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-title text-sand">Rough waters</h2>
        <p className="font-ui text-sm text-sand/40 max-w-[240px] mx-auto leading-relaxed">
          Something broke on our end. The ocean is unpredictable.
        </p>
        {error.digest && (
          <p className="font-mono text-[10px] text-sand/35 mt-1">
            ref: {error.digest}
          </p>
        )}
      </div>

      <button
        onClick={reset}
        className="px-8 py-3.5 rounded-full bg-seafoam/10 text-seafoam font-ui text-sm
                   font-medium hover:bg-seafoam/20 transition-colors press"
      >
        Try again
      </button>
    </div>
  )
}
