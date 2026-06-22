'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flag, CheckCheck, Bookmark } from 'lucide-react'
import {
  useMarkBottleReadMutation,
  useReportBottleMutation,
  useGetSavedBottlesQuery,
  useSaveBottleMutation,
  useUnsaveBottleMutation,
} from '@/store/api/bottleApi'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import type { Bottle } from '@/types'

interface ReceivedBottleProps {
  bottle: Bottle
}

export default function ReceivedBottle({ bottle }: ReceivedBottleProps) {
  const user = useAppSelector(selectUser)
  const [markRead, { isLoading: isMarking }] = useMarkBottleReadMutation()
  const [reportBottle, { isLoading: isReporting }] = useReportBottleMutation()

  // Saved-state comes from the shared shelf cache — one query, all cards read it.
  const { data: saved } = useGetSavedBottlesQuery(undefined, { skip: !user?.id })
  const [saveBottle, { isLoading: isSaving }] = useSaveBottleMutation()
  const [unsaveBottle, { isLoading: isUnsaving }] = useUnsaveBottleMutation()
  const isSaved = saved?.some((b) => b.id === bottle.id) ?? false
  const [cappedMsg, setCappedMsg] = useState(false)

  async function handleToggleSave() {
    setCappedMsg(false)
    if (isSaved) {
      await unsaveBottle(bottle.id)
      return
    }
    const res = await saveBottle(bottle.id).unwrap().catch(() => null)
    if (res?.capped) setCappedMsg(true)
  }

  const words = bottle.message.split(' ')

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative bg-ocean-mid rounded-card border border-border-subtle p-6 mx-4 shadow-card"
    >
      {/* Read indicator dot */}
      {!bottle.is_read && (
        <span
          className="absolute top-5 right-5 w-2 h-2 rounded-full bg-seafoam"
          aria-label="Unread"
        />
      )}

      {/* Message — staggered word reveal */}
      <div className="mb-5 pr-4">
        <p
          className="font-display text-sand text-lg leading-relaxed"
          aria-label="Message content"
        >
          {words.map((word, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.2 + Math.min(i * 0.025, 1.4),
                duration: 0.28,
                ease: 'easeOut',
              }}
              className="inline-block mr-[0.28em]"
            >
              {word}
            </motion.span>
          ))}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <time
          dateTime={bottle.sent_at}
          className="font-mono text-xs text-sand/30"
        >
          {new Date(bottle.sent_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </time>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleToggleSave()}
            disabled={isSaving || isUnsaving}
            className={`p-2 rounded-xl transition-colors disabled:opacity-40 disabled:pointer-events-none ${
              isSaved
                ? 'text-seafoam hover:text-seafoam/80'
                : 'text-sand/25 hover:text-seafoam/80'
            }`}
            aria-label={isSaved ? 'Remove from shelf' : 'Keep on shelf'}
            aria-pressed={isSaved}
            title={isSaved ? 'On your shelf' : 'Keep'}
          >
            <Bookmark
              size={15}
              strokeWidth={1.5}
              fill={isSaved ? 'currentColor' : 'none'}
            />
          </button>

          <button
            onClick={() => void reportBottle(bottle.id)}
            disabled={isReporting || bottle.is_reported}
            className="p-2 rounded-xl text-sand/25 hover:text-coral/80 transition-colors
                       disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Report this bottle"
            title="Report"
          >
            <Flag size={15} strokeWidth={1.5} />
          </button>

          {!bottle.is_read && (
            <button
              onClick={() => void markRead(bottle.id)}
              disabled={isMarking}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl
                         bg-seafoam/10 text-seafoam font-ui text-xs font-medium
                         hover:bg-seafoam/20 transition-colors disabled:opacity-50"
            >
              <CheckCheck size={14} strokeWidth={2} />
              Mark read
            </button>
          )}

          {bottle.is_read && (
            <span className="font-ui text-xs text-sand/25 flex items-center gap-1">
              <CheckCheck size={13} strokeWidth={1.5} />
              Read
            </span>
          )}
        </div>
      </div>

      {/* Free-shelf cap reached — gentle upsell, not an error. */}
      <AnimatePresence>
        {cappedMsg && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="font-ui text-xs text-sand/45 leading-relaxed pt-3 mt-1"
          >
            Your shelf holds 3 bottles. Unkeep one to make room — or keep them all
            with Plus.
          </motion.p>
        )}
      </AnimatePresence>
    </motion.article>
  )
}
