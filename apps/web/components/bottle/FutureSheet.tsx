'use client'

import { useState } from 'react'
import Sheet from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import KeeperPlans from '@/components/keeper/KeeperPlans'
import { useGetFutureBottlesQuery, useSendFutureBottleMutation } from '@/store/api/bottleApi'
import type { BottleStyle, Weather } from '@/lib/dressing'

// "Future me" (migration 047): send what's in the box to yourself instead of
// a stranger; it washes back in 1, 6 or 12 months. A Keeper perk, one a week,
// and separate from the daily throw.

const WHEN = [
  { months: 1, label: 'A month' },
  { months: 6, label: 'Six months' },
  { months: 12, label: 'A year' },
] as const

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default function FutureSheet({
  message,
  style,
  weather,
  isKeeper,
  onSent,
  onClose,
  onBeforeCheckout,
}: {
  message: string
  style: BottleStyle
  weather: Weather | null
  isKeeper: boolean
  onSent: (deliverOn: string) => void
  onClose: () => void
  onBeforeCheckout: () => void
}) {
  const [months, setMonths] = useState<1 | 6 | 12>(6)
  const [error, setError] = useState<string | null>(null)
  const { data: future } = useGetFutureBottlesQuery(undefined, { skip: !isKeeper })
  const [send, { isLoading }] = useSendFutureBottleMutation()
  const waitUntil = future?.can_send_after ?? null
  const empty = message.trim().length === 0

  async function go() {
    setError(null)
    try {
      const r = await send({ message, months, style, weather }).unwrap()
      onSent(r.deliver_on)
      onClose()
    } catch (e) {
      setError((e as { error?: string }).error ?? 'Couldn’t send it. Please try again.')
    }
  }

  return (
    <Sheet title="Send to future me" onClose={onClose}>
        <p className="font-ui text-xs text-sand/50 leading-relaxed mb-4">
          Instead of a stranger, this bottle drifts back to you. It doesn&rsquo;t use today&rsquo;s throw.
        </p>

        {!isKeeper ? (
          <div className="rounded-2xl border border-seafoam/20 bg-seafoam/5 p-4 flex flex-col gap-3">
            <p className="font-ui text-sm text-sand/80">Letters to yourself are for Keepers.</p>
            <KeeperPlans returnTo="home" onBeforeCheckout={onBeforeCheckout} />
          </div>
        ) : waitUntil ? (
          <p className="font-ui text-sm text-sand/70 rounded-2xl border border-white/10 p-4">
            One letter to yourself a week. The next one opens {fmt(waitUntil)}.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="When it washes back">
              {WHEN.map((w) => (
                <button key={w.months} type="button" aria-pressed={months === w.months}
                  onClick={() => setMonths(w.months)}
                  className={cn('press rounded-2xl border px-2 py-3 font-ui text-sm transition-[color,background-color,border-color,transform]',
                    months === w.months ? 'border-seafoam/50 bg-seafoam/10 text-sand' : 'border-white/10 text-sand/55 hover:text-sand/80')}>
                  {w.label}
                </button>
              ))}
            </div>
            {empty && <p className="font-ui text-xs text-sand/45 mt-3">Write something in the box first.</p>}
            {error && <p className="font-ui text-xs text-coral mt-3">{error}</p>}
            <button type="button" onClick={() => void go()} disabled={empty || isLoading}
              className="press mt-4 w-full py-3.5 rounded-full shadow-seafoam bg-seafoam text-ocean-deep font-ui font-semibold text-sm hover:brightness-110 disabled:opacity-50">
              {isLoading ? 'Sealing…' : 'Seal for future me'}
            </button>
          </>
        )}
        {future && future.waiting.length > 0 && isKeeper && (
          <p className="font-ui text-[11px] text-sand/35 mt-3 text-center">
            {future.waiting.length} letter{future.waiting.length === 1 ? '' : 's'} to yourself still drifting
          </p>
        )}
    </Sheet>
  )
}
