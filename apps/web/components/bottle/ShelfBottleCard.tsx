'use client'

import { motion } from 'framer-motion'
import { MessageCircle } from 'lucide-react'
import type { Bottle } from '@/types'
import type { Thread } from '@/types'

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
  const hasThread = Boolean(thread)

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        delay: index * 0.05,
        type: 'spring',
        stiffness: 400,
        damping: 28,
      }}
      onClick={() => onClick(bottle)}
      aria-label={`Bottle from ${new Date(bottle.received_at ?? bottle.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
      className="relative flex flex-col items-center justify-between w-full aspect-[3/4]
                 rounded-2xl overflow-hidden cursor-pointer group transition-all duration-200
                 hover:scale-[1.02] active:scale-[0.98]"
      style={{
        background: unread
          ? 'linear-gradient(160deg, #0E2540 0%, #0A1F35 100%)'
          : 'linear-gradient(160deg, #0D2137 0%, #0A1A2E 100%)',
        boxShadow: unread
          ? '0 0 0 1px rgba(78,205,196,0.22), 0 4px 16px rgba(0,0,0,0.3)'
          : '0 0 0 1px rgba(255,255,255,0.05), 0 4px 12px rgba(0,0,0,0.2)',
      }}
    >
      {/* Unread glow ring */}
      {unread && (
        <span
          className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-seafoam"
          style={{ boxShadow: '0 0 6px 2px rgba(78,205,196,0.5)' }}
          aria-label="Unread"
        />
      )}

      {/* Thread indicator */}
      {hasThread && (
        <span className="absolute top-2.5 left-2.5 text-seafoam/60">
          <MessageCircle size={12} strokeWidth={1.5} />
        </span>
      )}

      {/* Bottle SVG — inline so we can tint it */}
      <div className="flex flex-1 items-center justify-center w-full">
        <svg
          viewBox="0 0 44 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-10 h-auto transition-transform duration-300 group-hover:scale-105"
          aria-hidden="true"
        >
          {/* Neck */}
          <rect
            x="17"
            y="2"
            width="10"
            height="14"
            rx="3"
            fill={unread ? 'rgba(78,205,196,0.18)' : 'rgba(255,255,255,0.07)'}
            stroke={unread ? 'rgba(78,205,196,0.4)' : 'rgba(255,255,255,0.14)'}
            strokeWidth="1"
          />
          {/* Stopper */}
          <rect
            x="15.5"
            y="14"
            width="13"
            height="4"
            rx="2"
            fill={unread ? 'rgba(78,205,196,0.28)' : 'rgba(255,255,255,0.12)'}
          />
          {/* Body */}
          <path
            d="M10 22 Q8 28 8 40 Q8 68 22 70 Q36 68 36 40 Q36 28 34 22 L10 22Z"
            fill={unread ? 'rgba(78,205,196,0.1)' : 'rgba(255,255,255,0.05)'}
            stroke={unread ? 'rgba(78,205,196,0.35)' : 'rgba(255,255,255,0.12)'}
            strokeWidth="1.2"
          />
          {/* Shine */}
          <path
            d="M14 30 Q13 40 14 52"
            stroke={unread ? 'rgba(78,205,196,0.25)' : 'rgba(255,255,255,0.1)'}
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Message inside */}
          {unread && (
            <>
              <line x1="17" y1="38" x2="27" y2="38" stroke="rgba(78,205,196,0.35)" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="16" y1="43" x2="28" y2="43" stroke="rgba(78,205,196,0.25)" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="17" y1="48" x2="25" y2="48" stroke="rgba(78,205,196,0.18)" strokeWidth="1.2" strokeLinecap="round" />
            </>
          )}
        </svg>
      </div>

      {/* Date */}
      <div className="w-full px-3 pb-3 pt-1">
        <time
          dateTime={bottle.received_at ?? bottle.sent_at}
          className="font-mono text-[10px] text-center block"
          style={{ color: unread ? 'rgba(78,205,196,0.6)' : 'rgba(247,231,206,0.3)' }}
        >
          {new Date(bottle.received_at ?? bottle.sent_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </time>
      </div>
    </motion.button>
  )
}
