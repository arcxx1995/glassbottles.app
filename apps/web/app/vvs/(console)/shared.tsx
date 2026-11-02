'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/** Every console call. Each RPC checks is_admin() itself. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

/** Stops a banned person's renewing subscription. Surfaced, so it can't fail quietly. */
export async function cancelBilling(userId: string): Promise<string> {
  const res = await fetch('/api/vvs/billing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  }).catch(() => null)
  const body = (await res?.json().catch(() => null)) as { result?: string } | null
  if (!res?.ok) return 'Banned, but cancelling their subscription FAILED. Cancel it in Dodo, or they’ll keep being charged.'
  return body?.result === 'cancelled' ? 'Banned, and their subscription was cancelled.' : 'Banned. They had no renewing subscription.'
}

export const ERRORS: Record<string, string> = {
  note_required: 'Write a reason first. It goes in the log.',
  cannot_act_on_self: 'You can’t do that to your own account.',
  bad_days: 'Suspensions are 7 or 30 days.',
  not_found: 'That wasn’t found.',
}
export const errorText = (e: unknown) => {
  const m = e instanceof Error ? e.message : ''
  return ERRORS[m] ?? (m || 'That didn’t go through. Try again.')
}

/** The anonymous name a person goes by in here. */
export const caseId = (id: string | null | undefined) => (id ? id.slice(0, 8) : 'deleted')

export const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : ''

export const REASON: Record<string, string> = {
  sexual: 'Sexual',
  harassment: 'Abusive',
  spam: 'Spam',
  contact: 'Contact info',
  other: 'Other',
  minor: 'Involves a minor',
  danger: 'Someone may be in danger',
  unspecified: 'No reason given',
  block: 'Block',
  strikes: '3 strikes',
  harm: 'Harmful',
  review: 'Needs review',
}
export const KIND: Record<string, string> = {
  bottle: 'Bottle',
  kayak_note: 'Kayak note',
  kayak_comment: 'Kayak comment',
  block: 'Block',
  strikes: '3 strikes in 30 days',
}

export function Pill({ tone = 'plain', children }: { tone?: 'plain' | 'bad' | 'good' | 'warn'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full px-2 py-0.5 font-ui text-[11px] font-medium',
        tone === 'bad' && 'bg-coral/20 text-coral',
        tone === 'good' && 'bg-seafoam/15 text-seafoam',
        tone === 'warn' && 'bg-[#E8B65A]/20 text-[#E8B65A]',
        tone === 'plain' && 'bg-white/10 text-sand/70',
      )}
    >
      {children}
    </span>
  )
}

export const statusTone = (s: string | null | undefined) => (s === 'banned' || s === 'suspended' ? 'bad' : 'plain')

export function PersonLink({ id, role }: { id: string | null; role?: string }) {
  const label = `${role ? `${role} ` : ''}${caseId(id)}`
  if (!id) return <span className="font-mono text-xs text-sand/40">{label}</span>
  return (
    <Link href={`/vvs/people/${id}` as Route} className="font-mono text-xs text-seafoam hover:underline">
      {label}
    </Link>
  )
}

export const CARD = 'rounded-card border border-border-subtle bg-ocean-mid p-4'
export const FIELD =
  'w-full rounded-xl border border-border-subtle bg-ocean-deep px-3 py-2 font-ui text-sm text-sand placeholder:text-sand/35 outline-none focus:border-seafoam/50'
export const BTN = 'press rounded-xl px-3 py-1.5 font-ui text-xs font-medium disabled:opacity-40'
