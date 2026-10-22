'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useGetKeeperQuery } from '@/store/api/bottleApi'

// The Keeper plan picker, shared by the settings card and the Atelier sheet.
// Each button starts a Dodo hosted checkout; access arrives later through the
// signed webhook (migration 041), never from this page.

type Plan = 'monthly' | 'yearly' | 'lifetime'

/** POST a billing route and return the hosted page URL it hands back. */
export async function billingUrl(path: string, body?: unknown): Promise<string> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !json.url) throw new Error(json.error ?? 'Something went wrong. Please try again.')
  return json.url
}

export default function KeeperPlans({
  returnTo = 'settings',
  onBeforeCheckout,
}: {
  returnTo?: 'settings' | 'home'
  /** Stash anything the redirect to Dodo would lose (e.g. a half-written bottle). */
  onBeforeCheckout?: () => void
}) {
  const { data } = useGetKeeperQuery()
  const [busy, setBusy] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const trial = !data?.membership // one trial per account
  const spots = data?.foundingSpotsLeft ?? 0

  async function checkout(plan: Plan) {
    setBusy(plan)
    setError(null)
    try {
      const url = await billingUrl('/api/billing/checkout', { plan, returnTo })
      onBeforeCheckout?.()
      window.location.assign(url)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <PlanButton
        label="Yearly"
        price="$24 / year"
        note={trial ? '7-day free trial · save a third' : 'Save a third'}
        highlight
        busy={busy === 'yearly'}
        disabled={busy !== null}
        onClick={() => void checkout('yearly')}
      />
      <PlanButton
        label="Monthly"
        price="$2.99 / month"
        note={trial ? '7-day free trial' : undefined}
        busy={busy === 'monthly'}
        disabled={busy !== null}
        onClick={() => void checkout('monthly')}
      />
      {spots > 0 && (
        <PlanButton
          label="Founding Keeper"
          price="$49 once"
          note={`Forever · ${spots} of 100 left`}
          busy={busy === 'lifetime'}
          disabled={busy !== null}
          onClick={() => void checkout('lifetime')}
        />
      )}
      <p className="font-ui text-[10px] text-sand/40 leading-snug px-1">
        Prices in USD; checkout shows your local currency. Cancel anytime.
      </p>
      {error && <p className="font-ui text-xs text-coral">{error}</p>}
    </div>
  )
}

function PlanButton({
  label,
  price,
  note,
  highlight = false,
  busy,
  disabled,
  onClick,
}: {
  label: string
  price: string
  note?: string
  highlight?: boolean
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-[border-color,background-color,transform] press disabled:opacity-50',
        highlight
          ? 'border-seafoam/40 bg-seafoam/10 hover:bg-seafoam/15'
          : 'border-white/10 hover:border-white/20',
      )}
    >
      <span className="flex flex-col min-w-0">
        <span className="font-ui text-sm font-medium text-sand/90">{label}</span>
        {note && <span className="font-ui text-[11px] text-sand/40 mt-0.5">{note}</span>}
      </span>
      <span className={cn('font-mono text-xs shrink-0', highlight ? 'text-seafoam' : 'text-sand/60')}>
        {busy ? 'Opening…' : price}
      </span>
    </button>
  )
}
