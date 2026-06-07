'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  selectShowReceivedBanner,
  setShowReceivedBanner,
} from '@/store/uiSlice'

const AUTO_DISMISS_MS = 5000

/**
 * ReceivedBanner
 *
 * Slide-in toast shown when Supabase Realtime delivers a new bottle to the
 * current user during their session. The RealtimeBottleListener dispatches
 * setShowReceivedBanner(true); this component reads that flag and renders.
 *
 * Auto-dismisses after 5 seconds. Tapping navigates to /inbox.
 * Rendered once in (app)/layout.tsx — no duplicates.
 */
export default function ReceivedBanner() {
  const dispatch = useAppDispatch()
  const router = useRouter()
  const isVisible = useAppSelector(selectShowReceivedBanner)

  // Auto-dismiss
  useEffect(() => {
    if (!isVisible) return
    const timer = setTimeout(() => {
      dispatch(setShowReceivedBanner(false))
    }, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [isVisible, dispatch])

  function handleTap() {
    dispatch(setShowReceivedBanner(false))
    router.push('/inbox')
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          key="received-banner"
          initial={{ opacity: 0, y: -72, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -72, scale: 0.95 }}
          transition={{
            type: 'spring',
            stiffness: 320,
            damping: 28,
          }}
          onClick={handleTap}
          className="fixed top-4 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-sm
                     -translate-x-1/2 flex items-center gap-3
                     bg-ocean-mid border border-seafoam/20 rounded-2xl
                     px-4 py-3.5 shadow-lg shadow-black/30
                     text-left cursor-pointer"
          aria-live="assertive"
          aria-atomic="true"
          role="alert"
        >
          {/* Bottle icon pulse */}
          <motion.span
            className="text-2xl select-none shrink-0"
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            role="img"
            aria-label="glass bottle"
          >
            🫙
          </motion.span>

          <div className="flex-1 min-w-0">
            <p className="font-ui text-sm font-medium text-sand leading-snug">
              A bottle found you
            </p>
            <p className="font-ui text-xs text-sand/45 mt-0.5">
              Tap to read your message
            </p>
          </div>

          {/* Progress bar */}
          <motion.div
            className="absolute bottom-0 left-0 h-[2px] bg-seafoam/50 rounded-full"
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: AUTO_DISMISS_MS / 1000, ease: 'linear' }}
          />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
