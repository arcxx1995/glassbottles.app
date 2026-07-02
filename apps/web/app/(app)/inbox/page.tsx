'use client'

import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Mail } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetReceivedBottlesQuery } from '@/store/api/bottleApi'
import ReceivedBottle from '@/components/bottle/ReceivedBottle'

export default function InboxPage() {
  const user = useAppSelector(selectUser)

  const { data, isLoading } = useGetReceivedBottlesQuery(undefined, {
    skip: !user?.id,
  })

  // Most recently received on top. Sort client-side so the order is correct
  // regardless of the RPC's ORDER BY (defends against a stale deployed fn).
  const bottles = useMemo(
    () =>
      data
        ? [...data].sort(
            (a, b) =>
              // received_at is non-null for received bottles, but the type
              // allows null — coalesce to epoch 0 to satisfy the date math.
              new Date(b.received_at ?? 0).getTime() -
              new Date(a.received_at ?? 0).getTime(),
          )
        : data,
    [data],
  )

  const unreadCount = bottles?.filter((b) => !b.is_read).length ?? 0

  return (
    <div className="flex h-full flex-col overflow-hidden pt-10 sm:pt-14">
      {/* Header — fixed; only the list region below scrolls */}
      <div className="px-5 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl text-sand">Inbox</h1>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-5 h-5 rounded-full bg-coral text-ocean-deep font-ui
                         font-semibold text-[10px] flex items-center justify-center"
            >
              {unreadCount}
            </motion.span>
          )}
        </div>
        <p className="font-ui text-sm text-sand/40 mt-1">Bottles that found you</p>
      </div>

      {/* Scroll region — page frame + nav stay put, content scrolls inside */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
      {/* Loading skeletons */}
      {isLoading && (
        <div className="flex flex-col gap-4 px-0">
          {[1, 0.7, 0.4].map((opacity, i) => (
            <div
              key={i}
              className="mx-4 h-40 rounded-3xl bg-ocean-mid animate-pulse"
              style={{ opacity }}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!bottles || bottles.length === 0) && (
        <motion.div
          className="flex flex-col items-center justify-center flex-1 gap-5 text-center px-8 pt-16"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="w-16 h-16 rounded-full bg-ocean-mid flex items-center justify-center">
            <Mail size={26} className="text-sand/20" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-ui text-sand/40 text-sm">No bottles yet</p>
            <p className="font-ui text-xs text-sand/25 leading-relaxed">
              Throw one first — the ocean returns the favour.
            </p>
          </div>
        </motion.div>
      )}

      {/* Bottle list */}
      {!isLoading && bottles && bottles.length > 0 && (
        <div className="flex flex-col gap-4">
          {bottles.map((bottle, i) => (
            <motion.div
              key={bottle.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                // Cap the stagger so deep lists don't leave late cards waiting.
                delay: Math.min(i, 8) * 0.06,
                duration: 0.35,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
            >
              <ReceivedBottle bottle={bottle} />
            </motion.div>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
