'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import {
  useGetTodayBottleStatusQuery,
  useAckDeliveredBottlesMutation,
} from '@/store/api/bottleApi'
import { BottleSVG } from '@/components/bottle/ThrowAnimation'

interface DeliveredBannerProps {
  /** Preview-only: render regardless of server state (/preview page). */
  previewVisible?: boolean
  onPreviewDismiss?: () => void
}

/**
 * DeliveredBanner
 *
 * Persistent toast: one of the user's sent bottles was matched to a stranger.
 *
 * Visibility DERIVES from server state — a bottle with received_at set and
 * delivered_ack_at NULL exists (migration 016) — not from catching a Realtime
 * event. Missed broadcasts, reloads and other devices all converge on the same
 * truth: the toast shows until the sender explicitly dismisses it, and the
 * dismissal is persisted in the database (ack_delivered_bottles RPC), so it
 * never re-announces an already-acknowledged delivery.
 *
 * Rendered once in (app)/layout.tsx.
 */
export default function DeliveredBanner({
  previewVisible,
  onPreviewDismiss,
}: DeliveredBannerProps = {}) {
  const user = useAppSelector(selectUser)
  // Hide instantly on dismiss; the DB ack + refetch confirm in the background.
  const [acking, setAcking] = useState(false)

  const { data: status } = useGetTodayBottleStatusQuery(undefined, {
    skip: !user?.id || previewVisible !== undefined,
  })
  const [ackDelivered] = useAckDeliveredBottlesMutation()

  const hasUnacked = (status?.unackedDelivered ?? []).length > 0

  // Release the local hide only once the refetched status confirms the ack —
  // prevents a flash-back between mutation success and refetch completion,
  // while keeping the banner armed for future deliveries.
  useEffect(() => {
    if (!hasUnacked && acking) setAcking(false)
  }, [hasUnacked, acking])

  const isVisible =
    previewVisible !== undefined
      ? previewVisible
      : hasUnacked && !acking

  function handleDismiss() {
    if (previewVisible !== undefined) {
      onPreviewDismiss?.()
      return
    }
    setAcking(true)
    // Persist the ack; invalidation refetches status and hasUnacked goes false
    // (the effect above then releases the local hide). On failure, release
    // immediately so the (still true) toast returns.
    ackDelivered()
      .unwrap()
      .catch(() => setAcking(false))
  }

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
          {/* The app bottle — static, signals your bottle reached someone */}
          <span className="shrink-0 select-none" role="img" aria-label="bottle delivered">
            <BottleSVG glowing width={26} height={39} />
          </span>

          <div className="flex-1 min-w-0">
            <p className="font-ui text-sm font-medium text-sand leading-snug">
              Your bottle found someone
            </p>
            <p className="font-ui text-xs text-sand/45 mt-0.5">
              A stranger is reading your message right now.
            </p>
          </div>

          <button
            onClick={handleDismiss}
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
