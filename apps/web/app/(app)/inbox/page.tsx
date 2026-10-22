'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { spring, springFlick } from '@/components/ui/springs'
import { BookOpen, Mail } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetFutureBottlesQuery, useGetReceivedBottlesQuery } from '@/store/api/bottleApi'
import ReceivedBottle from '@/components/bottle/ReceivedBottle'
import FutureBottleCard from '@/components/bottle/FutureBottleCard'

export default function InboxPage() {
  const user = useAppSelector(selectUser)

  const { data, isLoading: isQueryLoading, isError, isFetching, refetch } = useGetReceivedBottlesQuery(undefined, {
    skip: !user?.id,
    // The inbox has no poll of its own — its refresh comes from the realtime
    // listener's invalidation and BottomNav's 5-minute safety poll. If the
    // socket is dead and the nav unmounts, an open tab would show a stale list
    // forever. Refetch on mount when the cache is older than 30s: navigating
    // back to the inbox is the moment the user expects it to be current.
    refetchOnMountOrArgChange: 30,
  })

  // Most recently received on top. Sort client-side so the order is correct
  // regardless of the RPC's ORDER BY (defends against a stale deployed fn).
  const bottles = useMemo(
    () =>
      data
        ? [...data].sort(
            (a, b) =>
              // received_at is non-null for received bottles, but the type
              // allows null — coalesce to epoch 0 to satisfy the date math.
              new Date(b.received_at ?? 0).getTime() -
              new Date(a.received_at ?? 0).getTime(),
          )
        : data,
    [data],
  )

  const unreadCount = bottles?.filter((b) => !b.is_read).length ?? 0

  // Letters to yourself (047): arrived ones lead the inbox; waiting ones are
  // only counted — their words stay sealed until they arrive.
  const { data: future } = useGetFutureBottlesQuery(undefined, {
    skip: !user?.id || process.env.NEXT_PUBLIC_KEEPER !== 'on',
  })
  const arrived = future?.arrived ?? []
  const waiting = future?.waiting.length ?? 0

  // Keepsakes (045): the same list, narrowed to the bottles kept.
  const [onlyKept, setOnlyKept] = useState(false)
  const keptCount = bottles?.filter((b) => b.kept_at).length ?? 0
  const shown = onlyKept ? bottles?.filter((b) => b.kept_at) : bottles
  useEffect(() => {
    if (keptCount === 0) setOnlyKept(false)
  }, [keptCount])

  // While AuthProvider seeds the user the query is skipped, and a skipped
  // query is not "loading" — the inbox flashed "No bottles yet" on reload.
  const isLoading = isQueryLoading || (!user?.id && !data)
  const failed = isError && !data

  const firstUnreadId = shown?.find((b) => !b.is_read)?.id
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(t)
  }, [notice])

  return (
    <div className="flex h-full flex-col overflow-hidden pt-10 sm:pt-14">
      {/* Header — fixed; only the list region below scrolls */}
      <div className="px-5 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-title text-sand">Inbox</h1>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={springFlick}
              className="w-5 h-5 rounded-full bg-coral text-ocean-deep font-ui
                         font-semibold text-[10px] flex items-center justify-center"
            >
              {unreadCount}
            </motion.span>
          )}
          {process.env.NEXT_PUBLIC_KEEPER === 'on' && (
            <TransitionLink
              href="/logbook"
              className="press ml-auto flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-ui text-xs text-sand/50 hover:text-sand/85 transition-[color,transform]"
            >
              <BookOpen size={14} strokeWidth={1.5} />
              Logbook
            </TransitionLink>
          )}
        </div>
        <p className="font-ui text-sm text-sand/40 mt-1">Bottles that found you</p>
        {waiting > 0 && (
          <p className="font-ui text-xs text-seafoam/60 mt-1">
            {waiting} letter{waiting === 1 ? '' : 's'} to yourself drifting back
          </p>
        )}
        {keptCount > 0 && (
          <div className="mt-4 flex gap-2" role="group" aria-label="Show">
            {[
              { on: !onlyKept, label: 'All', set: false },
              { on: onlyKept, label: `Kept · ${keptCount}`, set: true },
            ].map((t) => (
              <button
                key={t.label}
                type="button"
                aria-pressed={t.on}
                onClick={() => setOnlyKept(t.set)}
                className={`press h-8 rounded-full border px-3 font-ui text-xs transition-[color,background-color,border-color,transform] ${
                  t.on ? 'border-seafoam/50 bg-seafoam/10 text-sand/90' : 'border-white/10 text-sand/45 hover:text-sand/70'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scroll region — page frame + nav stay put, content scrolls inside */}
      <div className="edge-fade-b flex min-h-0 flex-1 flex-col overflow-y-auto pb-12">
      {/* Loading skeletons */}
      {isLoading && (
        <div className="flex flex-col gap-4 px-0">
          {[1, 0.7, 0.4].map((opacity, i) => (
            <div
              key={i}
              className="mx-4 h-40 rounded-3xl skeleton"
              style={{ opacity }}
            />
          ))}
        </div>
      )}

      {/* Failed load — distinct from an empty inbox */}
      {!isLoading && failed && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center px-8 pt-16" role="alert">
          <p className="font-ui text-sand/50 text-sm">Couldn&rsquo;t reach your inbox.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="press px-5 py-2 rounded-full bg-seafoam/10 text-seafoam font-ui text-xs font-medium hover:bg-seafoam/20 transition-[background-color,transform] disabled:opacity-50"
          >
            {isFetching ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}

      {/* Letters to yourself, newest first, above the strangers' bottles */}
      {!isLoading && !onlyKept && arrived.length > 0 && (
        <div className="flex flex-col gap-4 mb-4">
          {arrived.map((b) => (
            <FutureBottleCard key={b.id} bottle={b} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !failed && (!bottles || bottles.length === 0) && arrived.length === 0 && (
        <motion.div
          className="flex flex-col items-center justify-center flex-1 gap-5 text-center px-8 pt-16"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          <div className="w-16 h-16 rounded-full glass-fill flex items-center justify-center">
            <Mail size={26} className="text-sand/35" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-ui text-sand/40 text-sm">No bottles yet</p>
            <p className="font-ui text-xs text-sand/40 leading-relaxed">
              Throw one first — the ocean returns the favour.
            </p>
          </div>
        </motion.div>
      )}

      {/* Bottle list */}
      {!isLoading && shown && shown.length > 0 && (
        <div className="flex flex-col gap-4">
          {shown.map((bottle, i) => (
            <motion.div
              key={bottle.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              // Cap the stagger so deep lists don't leave late cards waiting.
              transition={{ ...spring, delay: Math.min(i, 6) * 0.04 }}
            >
              <ReceivedBottle
                bottle={bottle}
                arriving={bottle.id === firstUnreadId}
                onReported={(ok) =>
                  setNotice(ok ? 'Reported. That bottle is gone from your inbox.' : 'Couldn’t report that bottle. Try again.')
                }
              />
            </motion.div>
          ))}
        </div>
      )}
      </div>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
        style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }}>
        <AnimatePresence>
          {notice && (
            <motion.p
              key={notice}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={spring}
              className="rounded-2xl bg-ocean-deep/95 border border-white/10 px-4 py-2.5 font-ui text-xs text-sand/80 shadow-card"
            >
              {notice}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
