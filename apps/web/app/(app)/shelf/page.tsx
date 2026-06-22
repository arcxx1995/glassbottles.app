'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Anchor } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetReceivedBottlesQuery, useGetThreadsQuery } from '@/store/api/bottleApi'
import ShelfBottleCard from '@/components/bottle/ShelfBottleCard'
import BottlePopup from '@/components/bottle/BottlePopup'
import type { Bottle } from '@/types'

export default function ShelfPage() {
  const user = useAppSelector(selectUser)
  const [activeBottle, setActiveBottle] = useState<Bottle | null>(null)

  const { data: rawBottles, isLoading } = useGetReceivedBottlesQuery(undefined, {
    skip: !user?.id,
  })

  const { data: threads } = useGetThreadsQuery(undefined, {
    skip: !user?.id,
  })

  const bottles = useMemo(() => {
    if (!rawBottles) return rawBottles
    return [...rawBottles].sort(
      (a, b) =>
        new Date(b.received_at ?? 0).getTime() - new Date(a.received_at ?? 0).getTime(),
    )
  }, [rawBottles])

  const unreadCount = bottles?.filter((b) => !b.is_read).length ?? 0
  const count = bottles?.length ?? 0

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden pt-10 sm:pt-14">
        {/* Header */}
        <div className="px-5 mb-6">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl text-sand">Shelf</h1>
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

        {/* Scroll region — no visible scrollbar */}
        <div className="hide-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto pb-24 px-3">
          {/* Skeletons */}
          {isLoading && (
            <div className="grid grid-cols-7 gap-0">
              {[1, 0.8, 0.65, 0.5, 0.4, 0.3, 0.2].map((opacity, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl bg-ocean-mid/40 animate-pulse"
                  style={{ opacity }}
                />
              ))}
            </div>
          )}

          {/* Empty */}
          {!isLoading && count === 0 && (
            <motion.div
              className="flex flex-col items-center justify-center flex-1 gap-5 text-center px-8 pt-16"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="w-16 h-16 rounded-full bg-ocean-mid flex items-center justify-center">
                <Anchor size={24} className="text-sand/20" strokeWidth={1.5} />
              </div>
              <div className="flex flex-col gap-1">
                <p className="font-ui text-sand/40 text-sm">No bottles yet</p>
                <p className="font-ui text-xs text-sand/25 leading-relaxed">
                  Throw one into the sea — the ocean returns the favour.
                </p>
              </div>
            </motion.div>
          )}

          {/* Grid — 7 per row, no gap, bottles side by side */}
          {!isLoading && bottles && count > 0 && (
            <div className="grid grid-cols-7 gap-0">
              {bottles.map((bottle, i) => {
                const thread = threads?.find((t) => t.bottle_id === bottle.id)
                return (
                  <ShelfBottleCard
                    key={bottle.id}
                    bottle={bottle}
                    thread={thread}
                    index={i}
                    onClick={setActiveBottle}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Popup */}
      {activeBottle && (
        <BottlePopup
          bottle={activeBottle}
          onClose={() => setActiveBottle(null)}
        />
      )}
    </>
  )
}
