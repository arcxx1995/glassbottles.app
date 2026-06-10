'use client'

import { motion } from 'framer-motion'
import { Flag, CheckCheck } from 'lucide-react'
import { useMarkBottleReadMutation, useReportBottleMutation } from '@/store/api/bottleApi'
import type { Bottle } from '@/types'

interface ReceivedBottleProps {
  bottle: Bottle
}

export default function ReceivedBottle({ bottle }: ReceivedBottleProps) {
  const [markRead, { isLoading: isMarking }] = useMarkBottleReadMutation()
  const [reportBottle, { isLoading: isReporting }] = useReportBottleMutation()

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
    </motion.article>
  )
}
