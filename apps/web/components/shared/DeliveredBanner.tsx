'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
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
  // Ids snapshotted at dismiss time. Hiding by id (not a boolean) keeps the
  // banner armed for a NEW delivery that lands during the ack window — a
  // boolean `acking` never released while any unacked bottle existed, so that
  // delivery was suppressed for the whole session.
  const [ackedIds, setAckedIds] = useState<string[] | null>(null)

  const { data: status } = useGetTodayBottleStatusQuery(undefined, {
    skip: !user?.id || previewVisible !== undefined,
  })
  const [ackDelivered] = useAckDeliveredBottlesMutation()

  const unacked = status?.unackedDelivered ?? []
  // Deliveries not covered by the local dismiss — a fresh one shows instantly.
  const pending = ackedIds
    ? unacked.filter((b) => !ackedIds.includes(b.id))
    : unacked

  // Drop the snapshot once the refetch confirms the ack (nothing unacked
  // left). Holding it until then prevents a flash-back between mutation
  // success and refetch completion.
  useEffect(() => {
    if (ackedIds && unacked.length === 0) setAckedIds(null)
  }, [unacked.length, ackedIds])

  const isVisible =
    previewVisible !== undefined ? previewVisible : pending.length > 0

  function handleDismiss() {
    if (previewVisible !== undefined) {
      onPreviewDismiss?.()
      return
    }
    setAckedIds(unacked.map((b) => b.id))
    // Persist the ack; invalidation refetches status and the snapshot is
    // released by the effect above. On failure, release immediately so the
    // (still true) toast returns.
    ackDelivered()
      .unwrap()
      .catch(() => setAckedIds(null))
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
