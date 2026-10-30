'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser, setUser } from '@/store/authSlice'
import { CURRENTS, CURRENT_INFO, type CurrentId } from '@/lib/dressing'
import { spring } from '@/components/ui/springs'
import type { Profile } from '@/types'

const OPEN_SEA = '#4ECDC4' // the default accent, for the Open sea dot

// Your current (042): a name your bottles carry; for Keepers it also recolours
// the whole app (AppShell). A small pill on the Sea that opens a list.
export default function CurrentPicker({
  isKeeper,
  className,
}: {
  isKeeper: boolean
  className?: string
}) {
  const dispatch = useAppDispatch()
  const user = useAppSelector(selectUser)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const current = user?.current ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Optimistic: the colours change on tap; a failed save puts them back.
  async function choose(next: CurrentId | null) {
    if (!user || next === current) return
    setError(null)
    dispatch(setUser({ ...user, current: next }))
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: next }),
      })
      if (!res.ok) throw new Error('save failed')
      dispatch(setUser((await res.json()) as Profile))
    } catch {
      dispatch(setUser({ ...user, current }))
      setError('Couldn’t change your current. Try again.')
    }
  }

  const options: { id: CurrentId | null; name: string; blurb: string; dot: string }[] = [
    ...CURRENTS.map((c) => ({ id: c, name: CURRENT_INFO[c].name, blurb: CURRENT_INFO[c].blurb, dot: CURRENT_INFO[c].sea.foam })),
    { id: null, name: 'Open sea', blurb: 'No current', dot: OPEN_SEA },
  ]
  const shown = options.find((o) => o.id === current) ?? options[options.length - 1]

  return (
    <div ref={wrap} className={cn('pointer-events-auto relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Your current: ${shown.name}`}
        onClick={() => setOpen((v) => !v)}
        className="press glass-fill flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 font-ui text-xs text-sand/80 transition-[background-color,transform] hover:text-sand"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: shown.dot }} aria-hidden="true" />
        <span className="whitespace-nowrap">{shown.name}</span>
        <ChevronDown
          size={13}
          strokeWidth={1.75}
          className={cn('text-sand/50 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Your current"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={spring}
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 rounded-2xl border border-white/10 bg-ocean-mid/[0.97] p-1 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
          >
            <p className="px-2.5 pb-1 pt-1.5 font-ui text-[11px] leading-snug text-sand/45">
              Your bottles carry its name.{' '}
              {isKeeper ? 'The app wears its colours.' : 'Keepers see the whole app in its colours.'}
            </p>
            {options.map((o) => {
              const on = o.id === current
              return (
                <button
                  key={o.id ?? 'open'}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => void choose(o.id)}
                  className="press flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-[background-color,transform] hover:bg-white/[0.06] focus-visible:bg-white/[0.08] focus-visible:outline-none"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.dot }} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-ui text-sm text-sand/85">{o.name}</span>
                    <span className="font-ui text-[11px] text-sand/40">{o.blurb}</span>
                  </span>
                  {on && <Check size={14} strokeWidth={2} className="shrink-0 text-seafoam" aria-hidden="true" />}
                </button>
              )
            })}
            {error && (
              <p role="alert" className="px-2.5 pb-1.5 pt-1 font-ui text-[11px] text-coral">
                {error}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
