'use client'

import { motion } from 'framer-motion'
import { Bookmark } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetSavedBottlesQuery } from '@/store/api/bottleApi'
import ReceivedBottle from '@/components/bottle/ReceivedBottle'

export default function ShelfPage() {
  const user = useAppSelector(selectUser)
  const { data: bottles, isLoading } = useGetSavedBottlesQuery(undefined, {
    skip: !user?.id,
  })

  const count = bottles?.length ?? 0

  return (
    <div className="flex h-full flex-col overflow-hidden pt-10 sm:pt-14">
      {/* Header */}
      <div className="px-5 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl text-sand">Shelf</h1>
          {count > 0 && (
            <span className="font-mono text-xs text-sand/30">{count}/3</span>
          )}
        </div>
        <p className="font-ui text-sm text-sand/40 mt-1">Words you chose to keep</p>
      </div>

      {/* Scroll region */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        {isLoading && (
          <div className="flex flex-col gap-4">
            {[1, 0.6].map((opacity, i) => (
              <div
                key={i}
                className="mx-4 h-40 rounded-3xl bg-ocean-mid animate-pulse"
                style={{ opacity }}
              />
            ))}
          </div>
        )}

        {!isLoading && count === 0 && (
          <motion.div
            className="flex flex-col items-center justify-center flex-1 gap-5 text-center px-8 pt-16"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="w-16 h-16 rounded-full bg-ocean-mid flex items-center justify-center">
              <Bookmark size={24} className="text-sand/20" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-ui text-sand/40 text-sm">Your shelf is empty</p>
              <p className="font-ui text-xs text-sand/25 leading-relaxed">
                Keep a bottle that stays with you — it&apos;ll wait here for the
                days you need it.
              </p>
            </div>
          </motion.div>
        )}

        {!isLoading && bottles && count > 0 && (
          <div className="flex flex-col gap-4">
            {bottles.map((bottle, i) => (
              <motion.div
                key={bottle.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: i * 0.06,
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
