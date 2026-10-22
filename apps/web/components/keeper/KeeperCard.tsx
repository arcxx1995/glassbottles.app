'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGetKeeperQuery } from '@/store/api/bottleApi'
import { hasLiveSubscription } from '@/lib/keeper'
import KeeperPlans, { billingUrl } from './KeeperPlans'
import { spring } from '@/components/ui/springs'

// Keeper membership card for settings. The bottle stays free; Keeper is an
// optional membership for beautiful extras (Dodo Payments, migration 041).
// Shown only with NEXT_PUBLIC_KEEPER=on — it ships dark until the first
// perk exists, so nobody pays for nothing.

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default function KeeperCard() {
  const enabled = process.env.NEXT_PUBLIC_KEEPER === 'on'
  const { data, isLoading, isError } = useGetKeeperQuery(undefined, { skip: !enabled })
  // Back from Dodo checkout: the webhook may land a beat after the redirect.
  // (Read in an effect, not useSearchParams, so the page needs no Suspense.)
  const [welcome, setWelcome] = useState(false)
  useEffect(() => {
    setWelcome(new URLSearchParams(location.search).get('keeper') === 'welcome')
  }, [])
  // Collapsed like the other settings rows, so the no-scroll desktop layout
  // holds; opens by itself on the way back from checkout.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (welcome) setExpanded(true)
  }, [welcome])
  const [portalBusy, setPortalBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!enabled) return null

  async function openPortal() {
    setPortalBusy(true)
    setError(null)
    try {
      window.location.assign(await billingUrl('/api/billing/portal'))
    } catch (e) {
      setError((e as Error).message)
      setPortalBusy(false)
    }
  }

  const m = data?.membership ?? null
  const isKeeper = !!data?.isKeeper
  // past_due / on_hold: Dodo is still retrying the card — fix it, don't rebuy.
  const live = hasLiveSubscription(m)

  const title = isKeeper
    ? m?.plan === 'lifetime' ? 'Founding Keeper' : 'Keeper'
    : 'Become a Keeper'
  const meta = isLoading
    ? '…'
    : isKeeper && m
      ? m.plan === 'lifetime'
        ? 'Yours for good. Thank you for keeping the lights on.'
        : m.status === 'active'
          ? `Renews ${fmtDate(m.access_until)}`
          : `Ends ${fmtDate(m.access_until)}`
      : live
        ? 'A payment didn’t go through. Update it to keep Keeper.'
        : m
          ? `Ended ${fmtDate(m.access_until)} · rejoin any time`
        : 'The bottle is free, always. Keeper adds extras.'
  const canBuy = !isLoading && !isError && !isKeeper && !live
  const canManage = (isKeeper && m?.plan !== 'lifetime') || live

  return (
    <div className="glass rounded-3xl overflow-hidden">
      <button
        type="button"
        onClick={() => canBuy && setExpanded((v) => !v)}
        aria-expanded={canBuy ? expanded : undefined}
        className={cn('flex items-center gap-4 p-5 w-full text-left group', canBuy ? 'press cursor-pointer transition-transform' : 'cursor-default')}
      >
        <div className="w-9 h-9 rounded-xl bg-seafoam/10 flex items-center justify-center shrink-0">
          <Sparkles size={17} strokeWidth={1.5} className="text-seafoam" />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          {/* Status changes (loading → member, lapsed → rejoined) cross-fade in
              place instead of the text snapping. */}
          <motion.span
            key={title}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={spring}
            className="font-ui text-sm font-medium text-sand/70 group-hover:text-sand/90 transition-colors duration-200 whitespace-nowrap"
          >
            {title}
          </motion.span>
          {isLoading ? (
            <span className="skeleton mt-1.5 h-3 w-40 rounded-full" aria-label="Loading membership" />
          ) : (
            <motion.span
              key={meta}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className="font-ui text-xs text-sand/45 mt-0.5 leading-snug"
            >
              {meta}
            </motion.span>
          )}
        </div>
        {canBuy && (
          <span
            className={cn(
              'font-ui text-sand/45 text-lg leading-none transition-transform duration-300 ease-ease-quart',
              expanded && 'rotate-90',
            )}
          >
            ›
          </span>
        )}
      </button>

      {(welcome && !isKeeper && !isLoading) || isError || canManage || error ? (
        <div className="px-5 pb-5 -mt-1 flex flex-col gap-3">
          {welcome && !isKeeper && !isLoading && (
            <p className="font-ui text-xs text-seafoam/90 leading-relaxed">
              Welcome aboard. Your membership will appear here in a moment.
            </p>
          )}
          {isError && (
            <p className="font-ui text-xs text-coral">Couldn&rsquo;t load your membership.</p>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={portalBusy}
              className="press py-2.5 rounded-2xl border border-white/10 font-ui text-sm text-sand/70 transition-[color,border-color,transform] hover:text-sand hover:border-white/20 disabled:opacity-50"
            >
              {portalBusy ? 'Opening…' : 'Manage membership'}
            </button>
          )}
          {error && <p className="font-ui text-xs text-coral">{error}</p>}
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {canBuy && expanded && (
          <motion.div
            key="plans"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0">
              <KeeperPlans />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
