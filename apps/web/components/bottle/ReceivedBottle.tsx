'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Flag, CheckCheck, Bookmark, MessageCircle } from 'lucide-react'
import {
  useMarkBottleReadMutation,
  useReportBottleMutation,
  useGetSavedBottlesQuery,
  useSaveBottleMutation,
  useUnsaveBottleMutation,
  useGetThreadsQuery,
  useInitiateThreadMutation,
} from '@/store/api/bottleApi'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import type { Bottle } from '@/types'

interface ReceivedBottleProps {
  bottle: Bottle
}

export default function ReceivedBottle({ bottle }: ReceivedBottleProps) {
  const router = useRouter()
  const user = useAppSelector(selectUser)
  const [markRead, { isLoading: isMarking }] = useMarkBottleReadMutation()
  const [reportBottle, { isLoading: isReporting }] = useReportBottleMutation()

  // Saved-state comes from the shared shelf cache — one query, all cards read it.
  const { data: saved } = useGetSavedBottlesQuery(undefined, { skip: !user?.id })
  const [saveBottle, { isLoading: isSaving }] = useSaveBottleMutation()
  const [unsaveBottle, { isLoading: isUnsaving }] = useUnsaveBottleMutation()
  const isSaved = saved?.some((b) => b.id === bottle.id) ?? false
  const [cappedMsg, setCappedMsg] = useState(false)

  // Thread state — shared cache (one RPC call regardless of how many bottles shown).
  const { data: threads } = useGetThreadsQuery(undefined, { skip: !user?.id })
  const [initiateThread, { isLoading: isInitiating }] = useInitiateThreadMutation()
  const [plusMsg, setPlusMsg] = useState(false)
  const thread = threads?.find((t) => t.bottle_id === bottle.id)

  async function handleKeepTalking() {
    setPlusMsg(false)
    if (thread?.status === 'active') {
      router.push(`/threads/${thread.id}`)
      return
    }
    if (thread) return // pending or declined — no action
    const res = await initiateThread(bottle.id).unwrap().catch(() => null)
    if (res?.error === 'plus_required') {
      setPlusMsg(true)
    } else if (res?.thread_id) {
      router.push(`/threads/${res.thread_id}`)
    }
  }

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

        <div className="flex items-center gap-2 flex-wrap">
          {/* Keep talking — initiates a pen-pal thread (Plus feature) */}
          {!thread && (
            <button
              onClick={() => void handleKeepTalking()}
              disabled={isInitiating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                         bg-seafoam/8 text-seafoam/70 font-ui text-xs
                         hover:bg-seafoam/15 hover:text-seafoam transition-colors
                         disabled:opacity-40 disabled:pointer-events-none"
              title="Keep talking (Plus)"
            >
              <MessageCircle size={13} strokeWidth={1.5} />
              Keep talking
            </button>
          )}
          {thread?.status === 'active' && (
            <button
              onClick={() => router.push(`/threads/${thread.id}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                         bg-seafoam/15 text-seafoam font-ui text-xs font-medium
                         hover:bg-seafoam/25 transition-colors"
            >
              <MessageCircle size={13} strokeWidth={1.5} />
              Continue
            </button>
          )}
          {thread?.status === 'pending' && (
            <span className="font-ui text-xs text-sand/30 flex items-center gap-1">
              <MessageCircle size={12} strokeWidth={1.5} />
              Waiting…
            </span>
          )}

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

      {/* Upsell messages — soft, not errors */}
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
        {plusMsg && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="font-ui text-xs text-sand/45 leading-relaxed pt-3 mt-1"
          >
            Threads are a Plus feature — one conversation at a time, still
            anonymous. Coming soon.
          </motion.p>
        )}
      </AnimatePresence>
    </motion.article>
  )
}
