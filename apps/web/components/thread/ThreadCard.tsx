'use client'

import { motion } from 'framer-motion'
import { MessageCircle, Clock, CheckCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Thread } from '@/types'

interface ThreadCardProps {
  thread: Thread
  onClick: () => void
  onAccept?: () => void
  onDecline?: () => void
  isAccepting?: boolean
  isDeclining?: boolean
}

const STATUS_LABEL: Record<Thread['status'], string> = {
  pending: 'Waiting',
  active: 'Active',
  declined: 'Closed',
}

export default function ThreadCard({
  thread,
  onClick,
  onAccept,
  onDecline,
  isAccepting,
  isDeclining,
}: ThreadCardProps) {
  const isPendingRecipient = thread.status === 'pending' && thread.role === 'recipient'
  const hasUnread = thread.unread_count > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative bg-ocean-mid rounded-card border border-border-subtle mx-4 shadow-card overflow-hidden"
    >
      <button
        onClick={onClick}
        disabled={thread.status !== 'active'}
        className="w-full p-5 text-left disabled:cursor-default"
      >
        {/* Status + unread */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageCircle
              size={14}
              strokeWidth={1.5}
              className={cn(
                thread.status === 'active' ? 'text-seafoam' : 'text-sand/25'
              )}
            />
            <span
              className={cn(
                'font-ui text-[11px] font-medium',
                thread.status === 'active' ? 'text-seafoam' : 'text-sand/30'
              )}
            >
              {STATUS_LABEL[thread.status]}
            </span>
            <span className="font-ui text-[10px] text-sand/20">
              {thread.role === 'initiator' ? '· you asked' : '· they asked'}
            </span>
          </div>
          {hasUnread && thread.status === 'active' && (
            <span className="min-w-[18px] h-[18px] rounded-full bg-seafoam text-ocean-deep font-ui font-semibold text-[9px] flex items-center justify-center px-1">
              {thread.unread_count > 9 ? '9+' : thread.unread_count}
            </span>
          )}
        </div>

        {/* Preview: last message or original bottle snippet */}
        <p className="font-display text-sand text-sm leading-relaxed line-clamp-2 mb-2">
          {thread.last_message ?? thread.bottle_message}
        </p>

        {/* Timestamp */}
        <div className="flex items-center gap-1 text-sand/25">
          <Clock size={10} strokeWidth={1.5} />
          <time className="font-mono text-[10px]">
            {new Date(
              thread.last_message_at ?? thread.created_at
            ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </time>
          {thread.status === 'active' && !hasUnread && (
            <CheckCheck size={11} strokeWidth={1.5} className="ml-1" />
          )}
        </div>
      </button>

      {/* Pending recipient: accept / decline inline */}
      {isPendingRecipient && (
        <div className="px-5 pb-4 flex gap-2 border-t border-white/5 pt-3">
          <p className="font-ui text-xs text-sand/40 flex-1 self-center leading-relaxed">
            They want to keep talking about your bottle.
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); onDecline?.() }}
            disabled={isAccepting || isDeclining}
            className="px-3 py-1.5 rounded-xl font-ui text-xs text-sand/40 hover:text-sand/70
                       border border-white/10 hover:border-white/20 transition-colors
                       disabled:opacity-40 disabled:pointer-events-none"
          >
            Pass
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAccept?.() }}
            disabled={isAccepting || isDeclining}
            className="px-3 py-1.5 rounded-xl font-ui text-xs font-medium
                       bg-seafoam/15 text-seafoam hover:bg-seafoam/25 transition-colors
                       disabled:opacity-40 disabled:pointer-events-none"
          >
            {isAccepting ? '…' : 'Sure'}
          </button>
        </div>
      )}
    </motion.div>
  )
}
