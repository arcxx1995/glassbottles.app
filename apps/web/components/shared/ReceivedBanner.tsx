'use client'

import { motion, AnimatePresence } from 'motion/react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import {
  selectReceivedBannerDismissedIds,
  dismissReceivedBanner,
} from '@/store/uiSlice'
import { useGetReceivedBottlesQuery } from '@/store/api/bottleApi'
import { BottleSVG } from '@/components/bottle/ThrowAnimation'

interface ReceivedBannerProps {
  /** Preview-only: render regardless of server state (/preview page). */
  previewVisible?: boolean
  onPreviewDismiss?: () => void
}

/**
 * ReceivedBanner
 *
 * Persistent toast: "a bottle is waiting for you, unread".
 *
 * Visibility DERIVES from server state — an unread received bottle exists —
 * not from catching a Realtime event. A missed broadcast, dead websocket or
 * page reload cannot lose the notification: the next refetch (realtime
 * invalidation, 5-min poll, navigation) resurfaces it. The toast disappears
 * for good only when the bottle is actually read (is_read flips in the DB).
 *
 * No auto-dismiss. Tap → /inbox (hides for the session); X hides for the
 * session. Both reappear after reload while the bottle stays unread —
 * the banner is only ever shown when it is true.
 *
 * Shares the getReceivedBottles cache with BottomNav — adds no requests.
 * Rendered once in (app)/layout.tsx.
 */
export default function ReceivedBanner({
  previewVisible,
  onPreviewDismiss,
}: ReceivedBannerProps = {}) {
  const dispatch = useAppDispatch()
  const router = useRouter()
  const user = useAppSelector(selectUser)
  const dismissedIds = useAppSelector(selectReceivedBannerDismissedIds)

  const { data: bottles } = useGetReceivedBottlesQuery(undefined, {
    skip: !user?.id || previewVisible !== undefined,
  })
  // All unread, and the next one not yet dismissed this session. With several
  // unread bottles, dismissing one advances to the next instead of hiding all.
  const unreadList = bottles?.filter((b) => !b.is_read) ?? []
  const unread = unreadList.find((b) => !dismissedIds.includes(b.id))
  const unreadCount = unreadList.length

  const isVisible =
    previewVisible !== undefined ? previewVisible : Boolean(unread)

  function hide() {
    if (previewVisible !== undefined) {
      onPreviewDismiss?.()
    } else if (unread) {
      dispatch(dismissReceivedBanner(unread.id))
    }
  }

  function handleTap() {
    hide()
    router.push('/inbox')
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="received-banner"
          initial={{ opacity: 0, x: 80, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 80, scale: 0.95 }}
          transition={{
            type: 'spring',
            stiffness: 340,
            damping: 30,
          }}
          className="fixed top-4 right-4 z-[100] w-80 max-w-[calc(100vw-2rem)]
                     flex items-center gap-3 overflow-hidden
                     bg-ocean-mid border border-seafoam/20 rounded-2xl
                     px-4 py-3.5 shadow-banner text-left"
          aria-live="polite"
          aria-atomic="true"
          role="status"
        >
          <button
            onClick={handleTap}
            className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
          >
            {/* The app bottle — static, signals an arrival */}
            <span className="shrink-0 select-none" role="img" aria-label="glass bottle">
              <BottleSVG glowing width={26} height={39} />
            </span>

            <div className="flex-1 min-w-0">
              <p className="font-ui text-sm font-medium text-sand leading-snug">
                {unreadCount > 1
                  ? `${unreadCount} bottles found you`
                  : 'A bottle found you'}
              </p>
              <p className="font-ui text-xs text-sand/45 mt-0.5">
                {unreadCount > 1
                  ? 'Tap to read your messages'
                  : 'Tap to read your message'}
              </p>
            </div>
          </button>

          <button
            onClick={hide}
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
