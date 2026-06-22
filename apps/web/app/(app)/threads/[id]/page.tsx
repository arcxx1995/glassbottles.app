'use client'

import { use, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Send } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import {
  useGetThreadsQuery,
  useGetThreadMessagesQuery,
  useSendThreadMessageMutation,
  useMarkThreadReadMutation,
} from '@/store/api/bottleApi'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function ThreadPage({ params }: PageProps) {
  const { id: threadId } = use(params)
  const router = useRouter()
  const user = useAppSelector(selectUser)

  const { data: threads } = useGetThreadsQuery(undefined, { skip: !user?.id })
  const thread = threads?.find((t) => t.id === threadId)

  const { data: messages, isLoading } = useGetThreadMessagesQuery(threadId, {
    skip: !user?.id || !thread,
    // eslint-disable-next-line no-restricted-syntax -- polls a Supabase RPC (queryFn), not a Vercel /api route
    pollingInterval: 15_000,
    skipPollingIfUnfocused: true,
  })

  const [sendMessage, { isLoading: isSending }] = useSendThreadMessageMutation()
  const [markRead] = useMarkThreadReadMutation()
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages?.length])

  // Mark read on view
  useEffect(() => {
    if (thread?.unread_count && thread.unread_count > 0) {
      void markRead(threadId)
    }
  }, [threadId, thread?.unread_count, markRead])

  async function handleSend() {
    const msg = text.trim()
    if (!msg || isSending) return
    setText('')
    await sendMessage({ threadId, message: msg })
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  if (!user?.id) return null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-10 sm:pt-14 pb-4 border-b border-white/5">
        <button
          onClick={() => router.push('/threads')}
          className="p-2 -ml-1 rounded-xl text-sand/40 hover:text-sand/70 transition-colors"
          aria-label="Back to threads"
        >
          <ArrowLeft size={20} strokeWidth={1.5} />
        </button>
        <div className="flex flex-col">
          <span className="font-display text-sand text-base">Your stranger</span>
          {thread && (
            <span className="font-ui text-[11px] text-sand/30">
              {thread.status === 'active' ? 'Thread open' : 'Thread closed'}
            </span>
          )}
        </div>
      </div>

      {/* Original bottle context */}
      {thread && (
        <div className="px-4 py-3 bg-ocean-deep/40 border-b border-white/5">
          <p className="font-ui text-[11px] text-sand/30 uppercase tracking-widest mb-1">
            The bottle
          </p>
          <p className="font-display text-sand/60 text-sm leading-relaxed line-clamp-2">
            {thread.bottle_message}
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0">
        {isLoading && (
          <div className="flex justify-center pt-8">
            <div className="w-5 h-5 rounded-full border-2 border-seafoam/30 border-t-seafoam animate-spin" />
          </div>
        )}

        {!isLoading && (!messages || messages.length === 0) && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-ui text-xs text-sand/25 text-center pt-8"
          >
            Send the first message.
          </motion.p>
        )}

        <AnimatePresence initial={false}>
          {messages?.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex ${msg.is_mine ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[78%] px-4 py-3 rounded-2xl font-ui text-sm leading-relaxed ${
                  msg.is_mine
                    ? 'bg-seafoam/15 text-sand rounded-br-sm'
                    : 'bg-ocean-mid border border-border-subtle text-sand rounded-bl-sm'
                }`}
              >
                <p>{msg.message}</p>
                <time
                  dateTime={msg.sent_at}
                  className={`font-mono text-[10px] mt-1 block ${
                    msg.is_mine ? 'text-seafoam/50 text-right' : 'text-sand/25'
                  }`}
                >
                  {new Date(msg.sent_at).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input — only when thread is active */}
      {thread?.status === 'active' && (
        <div className="px-4 pb-safe pt-3 border-t border-white/5 bg-ocean-mid/80 backdrop-blur-md">
          <div className="flex items-end gap-2 max-w-md mx-auto">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="Write something…"
              maxLength={1000}
              rows={1}
              className="flex-1 resize-none bg-ocean-deep/60 border border-border-subtle
                         rounded-2xl px-4 py-3 font-ui text-sm text-sand placeholder-sand/25
                         focus:outline-none focus:border-seafoam/40 transition-colors
                         max-h-32 overflow-y-auto"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!text.trim() || isSending}
              className="p-3 rounded-2xl bg-seafoam/15 text-seafoam hover:bg-seafoam/25
                         transition-colors disabled:opacity-30 disabled:pointer-events-none
                         flex-shrink-0"
              aria-label="Send message"
            >
              <Send size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
