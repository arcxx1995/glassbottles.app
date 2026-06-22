'use client'

import { motion } from 'framer-motion'
import { BottleSVG } from '@/components/bottle/ThrowAnimation'
import type { Bottle, Thread } from '@/types'

interface ShelfBottleCardProps {
  bottle: Bottle
  thread?: Thread
  index?: number
  onClick: (bottle: Bottle) => void
}

export default function ShelfBottleCard({
  bottle,
  thread,
  index = 0,
  onClick,
}: ShelfBottleCardProps) {
  const unread = !bottle.is_read
  // Stagger bob so bottles don't move in lockstep
  const bobDelay = (index % 5) * 0.55

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      onClick={() => onClick(bottle)}
      aria-label={`Bottle received ${new Date(bottle.received_at ?? bottle.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
      className="relative flex flex-col items-center gap-1.5 py-2 px-0.5 rounded-xl
                 active:scale-95 transition-transform duration-150 w-full"
    >
      {/* Unread dot */}
      {unread && (
        <span
          className="absolute top-2 right-2 w-2 h-2 rounded-full bg-seafoam"
          style={{ boxShadow: '0 0 6px 2px rgba(78,205,196,0.55)' }}
          aria-label="Unread"
        />
      )}

      {/* Thread dot */}
      {thread && (
        <span
          className="absolute top-2 left-2 w-1.5 h-1.5 rounded-full"
          style={{ background: thread.status === 'active' ? '#4ECDC4' : 'rgba(255,255,255,0.25)' }}
        />
      )}

      {/* Bobbing bottle */}
      <motion.div
        animate={{ y: [0, -9, 0], rotate: [-1.2, 1.2, -1.2] }}
        transition={{
          duration: 3.2,
          ease: 'easeInOut',
          repeat: Infinity,
          delay: bobDelay,
        }}
        style={{
          filter: unread
            ? 'drop-shadow(0 0 8px rgba(78,205,196,0.5))'
            : 'drop-shadow(0 4px 8px rgba(0,0,0,0.35))',
        }}
      >
        <BottleSVG glowing={unread} width={56} height={84} />
      </motion.div>

      {/* Date */}
      <time
        dateTime={bottle.received_at ?? bottle.sent_at}
        className="font-mono text-[9px] leading-none"
        style={{ color: unread ? 'rgba(78,205,196,0.8)' : 'rgba(78,205,196,0.35)' }}
      >
        {new Date(bottle.received_at ?? bottle.sent_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}
      </time>
    </motion.button>
  )
}
