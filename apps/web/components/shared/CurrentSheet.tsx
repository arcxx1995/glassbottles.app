'use client'

import { useState } from 'react'
import Sheet from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser, setUser } from '@/store/authSlice'
import { CURRENTS, CURRENT_INFO, type CurrentId } from '@/lib/dressing'
import type { Profile } from '@/types'

// Your current (042): a cosmetic name your bottles carry; Keepers also sail
// its sea. Opened from the You menu.
export default function CurrentSheet({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch()
  const user = useAppSelector(selectUser)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = user?.current ?? null

  async function choose(next: CurrentId | null) {
    if (next === current) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: next }),
      })
      if (!res.ok) throw new Error('save failed')
      dispatch(setUser((await res.json()) as Profile))
    } catch {
      setError('Couldn’t change your current. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const option = (on: boolean) =>
    cn(
      'press flex flex-col items-start rounded-2xl border px-3 py-2.5 text-left transition-[border-color,background-color,transform] disabled:opacity-50',
      on ? 'border-seafoam/50 bg-seafoam/10' : 'border-white/10 hover:border-white/20',
    )

  return (
    <Sheet title="Your current" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="font-ui text-xs leading-relaxed text-sand/55">
          Your bottles carry your current&rsquo;s name to whoever finds them.
          {process.env.NEXT_PUBLIC_KEEPER === 'on' && ' Keepers also sail its sea.'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {CURRENTS.map((c) => (
            <button
              key={c}
              type="button"
              disabled={saving}
              aria-pressed={current === c}
              onClick={() => void choose(c)}
              className={option(current === c)}
            >
              <span className="font-ui text-sm text-sand/85">{CURRENT_INFO[c].name}</span>
              <span className="font-ui text-[11px] text-sand/40">{CURRENT_INFO[c].blurb}</span>
            </button>
          ))}
        </div>
        {current ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void choose(null)}
            className="self-start px-1 font-ui text-xs text-sand/45 transition-colors hover:text-sand/75"
          >
            Leave {CURRENT_INFO[current].name} for the open sea
          </button>
        ) : (
          <p className="px-1 font-ui text-xs text-sand/40">You&rsquo;re on the open sea.</p>
        )}
        {error && (
          <p role="alert" className="font-ui text-xs text-coral">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  )
}
