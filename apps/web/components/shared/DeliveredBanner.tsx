'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  selectShowDeliveredBanner,
  setShowDeliveredBanner,
} from '@/store/uiSlice'

/**
 * DeliveredBanner
 *
 * Persistent top-right toast shown when one of the user's own bottles is matched
 * to a stranger (RealtimeBottleListener sender channel dispatches
 * setShowDeliveredBanner(true)).
 *
 * Unlike ReceivedBanner, this does NOT auto-dismiss — it stays on the sailing
 * screen until the user taps the X. There is nothing to open (it's your own sent
 * bottle), so the only action is dismiss.
 *
 * Rendered once in (app)/layout.tsx.
 */
export default function DeliveredBanner() {
  const dispatch = useAppDispatch()
  const isVisible = useAppSelector(selectShowDeliveredBanner)

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="delivered-banner"
          initial={{ opacity: 0, x: 80, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 80, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          className="fixed top-4 right-4 z-[100] w-80 max-w-[calc(100vw-2rem)]
                     flex items-center gap-3 overflow-hidden
                     bg-ocean-mid border border-coral/25 rounded-2xl
                     px-4 py-3.5 shadow-banner text-left"
          role="status"
          aria-live="polite"
        >
          {/* Wave pulse — coral signals "your bottle reached someone" */}
          <motion.span
            className="text-2xl select-none shrink-0"
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            role="img"
            aria-label="bottle delivered"
          >
            🌊
          </motion.span>

          <div className="flex-1 min-w-0">
            <p className="font-ui text-sm font-medium text-sand leading-snug">
              Your bottle found someone
            </p>
            <p className="font-ui text-xs text-sand/45 mt-0.5">
              A stranger is reading your message right now.
            </p>
          </div>

          <button
            onClick={() => dispatch(setShowDeliveredBanner(false))}
            aria-label="Dismiss"
            className="shrink-0 -mr-1 p-1.5 rounded-full text-sand/40
                       hover:text-sand hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
