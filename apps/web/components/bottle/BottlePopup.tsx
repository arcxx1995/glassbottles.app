'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, MessageCircle, Bookmark, Flag, CheckCheck, Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'
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

interface BottlePopupProps {
  bottle: Bottle
  onClose: () => void
}

export default function BottlePopup({ bottle, onClose }: BottlePopupProps) {
  const router = useRouter()
  const user = useAppSelector(selectUser)
  const isPlus = user?.is_plus ?? false

  const [markRead] = useMarkBottleReadMutation()
  const [reportBottle, { isLoading: isReporting }] = useReportBottleMutation()

  const { data: saved } = useGetSavedBottlesQuery(undefined, { skip: !user?.id })
  const [saveBottle, { isLoading: isSaving }] = useSaveBottleMutation()
  const [unsaveBottle, { isLoading: isUnsaving }] = useUnsaveBottleMutation()
  const isSaved = saved?.some((b) => b.id === bottle.id) ?? false

  const { data: threads } = useGetThreadsQuery(undefined, { skip: !user?.id })
  const [initiateThread, { isLoading: isInitiating }] = useInitiateThreadMutation()
  const thread = threads?.find((t) => t.bottle_id === bottle.id)

  // Mark read on open
  useEffect(() => {
    if (!bottle.is_read) void markRead(bottle.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottle.id])

  async function handleKeepTalking() {
    if (!isPlus) return
    if (thread?.status === 'active') {
      onClose()
      router.push(`/threads/${thread.id}`)
      return
    }
    if (thread) return
    const res = await initiateThread(bottle.id).unwrap().catch(() => null)
    if (res?.thread_id) {
      onClose()
      router.push(`/threads/${res.thread_id}`)
    }
  }

  async function handleToggleSave() {
    if (isSaved) await unsaveBottle(bottle.id)
    else await saveBottle(bottle.id)
  }

  const words = bottle.message.split(' ')

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[200] bg-ocean-deep/70 backdrop-blur-sm flex items-center justify-center px-5"
        onClick={onClose}
      >
        <motion.article
          key="paper"
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-sm rounded-[20px] shadow-2xl overflow-hidden"
          style={{ background: '#F2E8D5' }}
        >
          {/* Paper texture top bar */}
          <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, #D9C9A8 0%, #EAD9BC 50%, #D9C9A8 100%)' }} />

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full transition-colors"
            style={{ color: '#8B7355' }}
            aria-label="Close"
          >
            <X size={16} strokeWidth={2} />
          </button>

          {/* Message */}
          <div className="px-7 pt-8 pb-5">
            <p
              className="font-display leading-relaxed text-base"
              style={{ color: '#1A2F4A' }}
            >
              {words.map((word, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.1 + Math.min(i * 0.022, 1.2),
                    duration: 0.25,
                    ease: 'easeOut',
                  }}
                  className="inline-block mr-[0.28em]"
                >
                  {word}
                </motion.span>
              ))}
            </p>
          </div>

          {/* Divider */}
          <div className="mx-7 border-t" style={{ borderColor: '#D4C4A8' }} />

          {/* Footer */}
          <div className="px-7 pt-3 pb-6">
            <time
              dateTime={bottle.sent_at}
              className="font-mono text-[10px] block mb-4"
              style={{ color: '#9B8B6E' }}
            >
              {new Date(bottle.sent_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </time>

            <div className="flex items-center gap-2">
              {/* Keep talking */}
              {!thread && (
                <button
                  onClick={() => void handleKeepTalking()}
                  disabled={isInitiating || !isPlus}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium font-ui transition-colors disabled:pointer-events-none"
                  style={
                    isPlus
                      ? { background: 'rgba(78,205,196,0.15)', color: '#2E9E96' }
                      : { background: 'rgba(0,0,0,0.06)', color: '#A89880' }
                  }
                  title={isPlus ? 'Start a thread' : 'Plus feature'}
                >
                  {isPlus
                    ? <MessageCircle size={13} strokeWidth={1.5} />
                    : <Lock size={11} strokeWidth={2} />
                  }
                  {isPlus ? 'Keep talking' : 'Plus'}
                </button>
              )}
              {thread?.status === 'active' && (
                <button
                  onClick={() => { onClose(); router.push(`/threads/${thread.id}`) }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium font-ui"
                  style={{ background: 'rgba(78,205,196,0.15)', color: '#2E9E96' }}
                >
                  <MessageCircle size={13} strokeWidth={1.5} />
                  Continue
                </button>
              )}
              {thread?.status === 'pending' && (
                <span className="font-ui text-xs flex items-center gap-1" style={{ color: '#A89880' }}>
                  <MessageCircle size={12} strokeWidth={1.5} />
                  Waiting…
                </span>
              )}

              <div className="flex-1" />

              {/* Save */}
              <button
                onClick={() => void handleToggleSave()}
                disabled={isSaving || isUnsaving}
                className="p-2 rounded-xl transition-colors disabled:opacity-40"
                style={{ color: isSaved ? '#2E9E96' : '#A89880' }}
                aria-label={isSaved ? 'Remove from shelf' : 'Keep'}
                aria-pressed={isSaved}
              >
                <Bookmark size={15} strokeWidth={1.5} fill={isSaved ? 'currentColor' : 'none'} />
              </button>

              {/* Report */}
              <button
                onClick={() => void reportBottle(bottle.id)}
                disabled={isReporting || bottle.is_reported}
                className="p-2 rounded-xl transition-colors disabled:opacity-30"
                style={{ color: '#C4957A' }}
                aria-label="Report"
              >
                <Flag size={14} strokeWidth={1.5} />
              </button>

              {/* Read state */}
              {bottle.is_read && (
                <span className="p-2" style={{ color: '#A89880' }} aria-label="Read">
                  <CheckCheck size={14} strokeWidth={1.5} />
                </span>
              )}
            </div>
          </div>
        </motion.article>
      </motion.div>
    </AnimatePresence>
  )
}
