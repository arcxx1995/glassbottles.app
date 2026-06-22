'use client'

import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { MessageCircle } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import {
  useGetThreadsQuery,
  useAcceptThreadMutation,
  useDeclineThreadMutation,
} from '@/store/api/bottleApi'
import ThreadCard from '@/components/thread/ThreadCard'

export default function ThreadsPage() {
  const router = useRouter()
  const user = useAppSelector(selectUser)
  const { data: threads, isLoading } = useGetThreadsQuery(undefined, {
    skip: !user?.id,
    // eslint-disable-next-line no-restricted-syntax -- polls a Supabase RPC (queryFn), not a Vercel /api route
    pollingInterval: 30_000,
    skipPollingIfUnfocused: true,
  })
  const [acceptThread, { isLoading: isAccepting }] = useAcceptThreadMutation()
  const [declineThread, { isLoading: isDeclining }] = useDeclineThreadMutation()

  const pending = threads?.filter(
    (t) => t.status === 'pending' && t.role === 'recipient'
  ) ?? []
  const active = threads?.filter((t) => t.status === 'active') ?? []
  const waiting = threads?.filter(
    (t) => t.status === 'pending' && t.role === 'initiator'
  ) ?? []

  const isEmpty = !isLoading && (threads?.length ?? 0) === 0

  return (
    <div className="flex h-full flex-col overflow-hidden pt-10 sm:pt-14">
      <div className="px-5 mb-6">
        <h1 className="font-display text-2xl text-sand">Threads</h1>
        <p className="font-ui text-sm text-sand/40 mt-1">Your ongoing conversations</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4 gap-3">
        {isLoading && (
          <>
            {[1, 0.6].map((op, i) => (
              <div
                key={i}
                className="mx-4 h-28 rounded-3xl bg-ocean-mid animate-pulse"
                style={{ opacity: op }}
              />
            ))}
          </>
        )}

        {isEmpty && (
          <motion.div
            className="flex flex-col items-center justify-center flex-1 gap-5 text-center px-8 pt-16"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="w-16 h-16 rounded-full bg-ocean-mid flex items-center justify-center">
              <MessageCircle size={24} className="text-sand/20" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-ui text-sand/40 text-sm">No threads yet</p>
              <p className="font-ui text-xs text-sand/25 leading-relaxed">
                When a bottle moves you, keep talking — tap &ldquo;Keep talking&rdquo; on any received bottle.
              </p>
            </div>
          </motion.div>
        )}

        {/* Pending invitations (I need to respond) */}
        {pending.length > 0 && (
          <section className="flex flex-col gap-3">
            <p className="font-ui text-[11px] text-sand/30 uppercase tracking-widest px-5">
              Wants to talk
            </p>
            {pending.map((t) => (
              <ThreadCard
                key={t.id}
                thread={t}
                onClick={() => {}}
                onAccept={() => void acceptThread(t.id)}
                onDecline={() => void declineThread(t.id)}
                isAccepting={isAccepting}
                isDeclining={isDeclining}
              />
            ))}
          </section>
        )}

        {/* Active threads */}
        {active.length > 0 && (
          <section className="flex flex-col gap-3">
            {pending.length > 0 && (
              <p className="font-ui text-[11px] text-sand/30 uppercase tracking-widest px-5 mt-2">
                Active
              </p>
            )}
            {active.map((t) => (
              <ThreadCard
                key={t.id}
                thread={t}
                onClick={() => router.push(`/threads/${t.id}`)}
              />
            ))}
          </section>
        )}

        {/* Waiting for response (I initiated, they haven't replied yet) */}
        {waiting.length > 0 && (
          <section className="flex flex-col gap-3 mt-2">
            <p className="font-ui text-[11px] text-sand/30 uppercase tracking-widest px-5">
              Waiting
            </p>
            {waiting.map((t) => (
              <ThreadCard
                key={t.id}
                thread={t}
                onClick={() => {}}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
