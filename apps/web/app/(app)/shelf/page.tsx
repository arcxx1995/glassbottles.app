'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TransitionLink, viewTransition } from '@/components/ui/TransitionLink'
import { spring } from '@/components/ui/springs'
import { PageTitle } from '@/components/layout/AppShell'
import { BookOpen } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import {
  useGetAtelierQuery,
  useGetFutureBottlesQuery,
  useGetKeeperQuery,
  useGetReceivedBottlesQuery,
} from '@/store/api/bottleApi'
import BottleDialog from '@/components/bottle/BottleDialog'
import ShelfBottle, { type ShelfItem } from '@/components/bottle/ShelfBottle'
import { BottleSVG, LIFT_TRANSITION } from '@/components/bottle/ThrowAnimation'

export default function ShelfPage() {
  const user = useAppSelector(selectUser)
  const keeperOn = process.env.NEXT_PUBLIC_KEEPER === 'on'

  const { data, isLoading: isQueryLoading, isError, isFetching, refetch } = useGetReceivedBottlesQuery(undefined, {
    skip: !user?.id,
    // The shelf has no poll of its own — its refresh comes from the realtime
    // listener's invalidation and BottomNav's 5-minute safety poll. If the
    // socket is dead and the nav unmounts, an open tab would show a stale list
    // forever. Refetch on mount when the cache is older than 30s: navigating
    // back to the shelf is the moment the user expects it to be current.
    refetchOnMountOrArgChange: 30,
  })

  // Letters to yourself (047): arrived ones sit among the rest; waiting ones
  // are only counted — their words stay sealed until they arrive.
  const { data: future } = useGetFutureBottlesQuery(undefined, {
    skip: !user?.id || !keeperOn,
  })
  const arrived = useMemo(() => future?.arrived ?? [], [future])
  const waiting = future?.waiting.length ?? 0

  const { data: pieces } = useGetAtelierQuery()
  const { data: keeper } = useGetKeeperQuery(undefined, { skip: !keeperOn })
  const isKeeper = !!keeper?.isKeeper

  // Most recently arrived on top. Sort client-side so the order is correct
  // regardless of the RPC's ORDER BY (defends against a stale deployed fn).
  const items = useMemo<ShelfItem[]>(
    () =>
      [
        ...(data ?? []).map((b) => ({
          id: b.id,
          // received_at is non-null for received bottles, but the type allows
          // null — coalesce to epoch 0 to satisfy the date math.
          at: b.received_at ?? new Date(0).toISOString(),
          unread: !b.is_read,
          kept: !!b.kept_at,
          letter: false,
          style: b.style,
        })),
        ...arrived.map((l) => ({
          id: l.id,
          at: l.delivered_at,
          unread: !l.read_at,
          kept: false,
          letter: true,
          style: l.style,
        })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    [data, arrived],
  )

  const unreadCount = items.filter((i) => i.unread).length

  // Keepsakes (045): the same shelf, narrowed to the bottles kept.
  const [onlyKept, setOnlyKept] = useState(false)
  const keptCount = items.filter((i) => i.kept).length
  const shown = onlyKept ? items.filter((i) => i.kept) : items
  useEffect(() => {
    if (keptCount === 0) setOnlyKept(false)
  }, [keptCount])

  // While AuthProvider seeds the user the query is skipped, and a skipped
  // query is not "loading" — the shelf flashed "No bottles yet" on reload.
  const isLoading = isQueryLoading || (!user?.id && !data)
  const failed = isError && !data

  // Where the banner's bottle lands: settled once on arrival. If it followed the
  // newest unread, opening one would promote the next above the dialog mid-lift.
  const [landingId, setLandingId] = useState(() => data?.find((b) => !b.is_read)?.id)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(t)
  }, [notice])

  // The tapped bottle lifts into the dialog and settles back on close: its name
  // moves between the plank and the dialog, one holder at a time.
  const [openId, setOpenId] = useState<string | null>(null)
  const liftedRef = useRef<HTMLElement | null>(null)
  const open = useCallback((id: string, lift: HTMLElement) => {
    liftedRef.current = lift
    lift.style.viewTransitionName = LIFT_TRANSITION
    void viewTransition(() => {
      lift.style.removeProperty('view-transition-name')
      setLandingId(undefined)
      setOpenId(id)
    })
  }, [])
  const close = useCallback(() => {
    const lift = liftedRef.current
    void viewTransition(() => {
      setOpenId(null)
      if (lift) lift.style.viewTransitionName = LIFT_TRANSITION
    }).finally(() => lift?.style.removeProperty('view-transition-name'))
  }, [])
  const onReported = useCallback((ok: boolean) => {
    if (ok) setOpenId(null)
    setNotice(ok ? 'Reported. That bottle is gone from your shelf.' : 'Couldn’t report that bottle. Try again.')
  }, [])

  return (
    <div className="relative flex h-full flex-col overflow-hidden pt-[4.5rem]">
      <div className="shelf-scene" aria-hidden />
      {/* Header — fixed; only the shelf below scrolls */}
      <div className="relative px-5 mb-6">
        <PageTitle title="The Shelf" line={unreadCount > 0 ? `${unreadCount} unread` : null} />
        <div className="flex items-center gap-2">
          <p className="font-ui text-sm text-sand/40">Bottles that found you</p>
          {keeperOn && (
            <TransitionLink
              href="/logbook"
              className="press ml-auto flex items-center gap-1.5 rounded-xl bg-black/20 px-2.5 py-1.5 font-ui text-xs text-white/85 backdrop-blur-md hover:text-white transition-[color,transform]"
            >
              <BookOpen size={14} strokeWidth={1.5} />
              Logbook
            </TransitionLink>
          )}
        </div>
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

      {/* Scroll region — page frame + nav stay put, the planks scroll inside */}
      <div className="edge-fade-b relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Failed load — distinct from an empty shelf */}
        {!isLoading && failed ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center px-8 pt-16" role="alert">
            <p className="font-ui text-sand/50 text-sm">Couldn&rsquo;t reach your shelf.</p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="press px-5 py-2 rounded-full bg-seafoam/10 text-seafoam font-ui text-xs font-medium hover:bg-seafoam/20 transition-[background-color,transform] disabled:opacity-50"
            >
              {isFetching ? 'Trying…' : 'Try again'}
            </button>
          </div>
        ) : (
          <div className="shelf-wall grid-cols-3 sm:grid-cols-4 lg:grid-cols-5">
            {isLoading &&
              [1, 0.8, 0.6, 0.45, 0.3, 0.2].map((opacity, i) => (
                <div key={i} className="flex items-end justify-center pb-6">
                  <div className="skeleton h-[84px] w-14 rounded-2xl" style={{ opacity }} />
                </div>
              ))}

            {!isLoading &&
              shown.map((item) => (
                <ShelfBottle
                  key={item.id}
                  item={item}
                  pieces={pieces}
                  isKeeper={isKeeper}
                  arriving={item.id === landingId}
                  lifted={item.id === openId}
                  onOpen={open}
                />
              ))}

            {/* Empty state: bare planks, waiting */}
            {!isLoading && items.length === 0 && (
              <motion.div
                className="absolute inset-x-0 top-6 flex flex-col items-center text-center px-8"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
              >
                {/* A ghost on the first plank; the words between it and the next. */}
                <div className="flex items-end opacity-40" style={{ height: 'calc(var(--shelf-row) - var(--shelf-plank))' }}>
                  <BottleSVG width={40} height={60} />
                </div>
                <div
                  className="flex flex-col gap-1 rounded-2xl bg-ocean-deep/70 px-4 py-3"
                  style={{ marginTop: 'calc(var(--shelf-plank) + 1.25rem)' }}
                >
                  <p className="font-ui text-sand/60 text-sm">No bottles yet</p>
                  <p className="font-ui text-xs text-sand/50 leading-relaxed">
                    Throw one first — the ocean returns the favour.
                  </p>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {openId && (
        <BottleDialog
          bottle={data?.find((b) => b.id === openId)}
          letter={arrived.find((l) => l.id === openId)}
          onClose={close}
          onReported={onReported}
        />
      )}

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
