'use client'

import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser, setUser } from '@/store/authSlice'
import { CURRENTS, CURRENT_INFO, type CurrentId, type SeaTheme } from '@/lib/dressing'
import Sheet from '@/components/ui/Sheet'
import WeatherLayer from './WeatherLayer'
import type { Profile } from '@/types'

// The classic ocean (SailingSea's defaults), for the Open sea tile.
const OPEN_SEA = {
  sky: 'linear-gradient(to bottom, #0A1628 0%, #0C2030 30%, #123A52 40%, #0E2B43 52%, #081826 100%)',
  bands: ['#173B54', '#0E2840', '#07141F'],
  foam: '#4ECDC4',
}

// Your current (042): a name your bottles carry. For Keepers it also paints the
// Sea, the Harbour and the app's chrome (AppShell).
export default function CurrentPicker({ isKeeper }: { isKeeper: boolean }) {
  const dispatch = useAppDispatch()
  const user = useAppSelector(selectUser)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = user?.current ?? null

  // Optimistic: the colours change on tap; a failed save puts them back and
  // reopens the dialog to say so.
  async function choose(next: CurrentId | null) {
    setOpen(false)
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
      setOpen(true)
    }
  }

  const shownName = current ? CURRENT_INFO[current].name : 'Open sea'
  const shownDot = current ? CURRENT_INFO[current].sea.foam : OPEN_SEA.foam

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Your current: ${shownName}`}
        onClick={() => setOpen(true)}
        className="press glass-fill pointer-events-auto flex h-8 w-8 items-center justify-center gap-1.5 rounded-full font-ui text-xs text-sand/80 transition-[background-color,transform] hover:text-sand sm:h-auto sm:w-auto sm:py-1 sm:pl-2.5 sm:pr-3"
      >
        <span className="h-3 w-3 shrink-0 rounded-full sm:h-2 sm:w-2" style={{ background: shownDot }} aria-hidden="true" />
        {/* Phones: the dot alone, so the centred title has room. */}
        <span className="hidden whitespace-nowrap sm:inline">Your current</span>
      </button>

      <AnimatePresence>
        {open && (
          <Sheet title="Your current" onClose={() => setOpen(false)}>
            <p className="mb-3 font-ui text-sm leading-relaxed text-sand/60">
              Your bottles carry its name.{' '}
              {isKeeper ? 'The Sea and the Harbour wear it.' : 'Keepers see the Sea and the Harbour wear it.'}
            </p>
            {error && (
              <p role="alert" className="mb-3 font-ui text-sm text-coral">
                {error}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {CURRENTS.map((id) => (
                <Tile
                  key={id}
                  name={CURRENT_INFO[id].name}
                  blurb={CURRENT_INFO[id].blurb}
                  sea={CURRENT_INFO[id].sea}
                  on={id === current}
                  onClick={() => void choose(id)}
                />
              ))}
              <Tile name="Open sea" blurb="No current" on={current === null} onClick={() => void choose(null)} />
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </>
  )
}

function Tile({ name, blurb, sea, on, onClick }: {
  name: string
  blurb: string
  sea?: SeaTheme
  on: boolean
  onClick: () => void
}) {
  const [back, middle, front] = sea ? [sea.bands[0], sea.bands[2], sea.bands[4]] : OPEN_SEA.bands
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'press flex flex-col overflow-hidden rounded-2xl border-2 text-left transition-[border-color,transform]',
        on ? 'border-seafoam' : 'border-white/10 hover:border-white/30',
      )}
    >
      {/* A still of that sea: sky, three bands of water, its weather. */}
      <span className="relative block h-20 w-full" style={{ background: sea?.sky ?? OPEN_SEA.sky }} aria-hidden="true">
        <span className="absolute inset-x-0 bottom-0 h-[56%] rounded-t-[50%_12px]" style={{ background: back }} />
        <span className="absolute inset-x-0 bottom-0 h-[38%] rounded-t-[60%_10px]" style={{ background: middle }} />
        <span
          className="absolute inset-x-0 bottom-0 h-[20%] rounded-t-[40%_8px] border-t"
          style={{ background: front, borderColor: sea?.foam ?? OPEN_SEA.foam }}
        />
        {sea && <WeatherLayer weather={sea.weather} sky={40} still density={0.4} scale={0.7} />}
      </span>
      <span className="flex items-start justify-between gap-1 px-2.5 py-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-ui text-sm text-sand/90">{name}</span>
          <span className="font-ui text-[11px] leading-snug text-sand/60">{blurb}</span>
        </span>
        {on && <Check size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-seafoam" aria-hidden="true" />}
      </span>
    </button>
  )
}
