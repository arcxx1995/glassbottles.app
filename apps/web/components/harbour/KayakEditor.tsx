'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import Sheet from '@/components/ui/Sheet'
import Switch from '@/components/ui/Switch'
import { INPUT_CLASS } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import {
  HANDLE_RE,
  HULLS,
  HULL_COLOR,
  PADDLES,
  PADDLE_COLOR,
  type Hull,
  type MyKayak,
  type Paddle,
} from '@/lib/harbour'
import { useClaimHandleMutation, useSaveKayakMutation, useUpdateBioMutation } from '@/store/api/bottleApi'
import KayakArt from './KayakArt'

// Launch a kayak, or change one: claim a handle (first time only — handles
// are permanent), write a short bio, pick hull and paddle, and float it in
// the Harbour or pull it ashore.

const ERRORS: Record<string, string> = {
  handle_taken: 'That handle is taken.',
  content_not_allowed: 'That handle or bio isn’t allowed here.',
  keeper_only: 'Only Keepers can float a kayak in the Harbour.',
  account_suspended: 'Your account is suspended.',
  age_unconfirmed: 'Please confirm you’re 18 or older first.',
}
const errorText = (err: unknown) => {
  const msg = (err as { error?: string })?.error ?? ''
  return ERRORS[msg] ?? (msg.includes('check constraint') ? 'Handles are 3–20 lowercase letters, numbers or _.' : 'Something went wrong. Try again.')
}

export default function KayakEditor({ mine, onClose }: { mine: MyKayak | null; onClose: () => void }) {
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState(mine?.bio ?? '')
  const [hull, setHull] = useState<Hull>(mine?.hull ?? 'yellow')
  const [paddle, setPaddle] = useState<Paddle>(mine?.paddle ?? 'red')
  const [parked, setParked] = useState(mine?.launched ? mine.parked : true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Claimed in an earlier try whose save failed: don't claim twice.
  const [claimed, setClaimed] = useState(false)
  const [claim] = useClaimHandleMutation()
  const [updateBio] = useUpdateBioMutation()
  const [save] = useSaveKayakMutation()

  const claiming = !mine
  const handleOk = !claiming || HANDLE_RE.test(handle)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!handleOk || busy) return
    setBusy(true)
    setError(null)
    try {
      if (claiming && !claimed) {
        await claim({ handle, bio }).unwrap()
        setClaimed(true)
      } else if (mine && bio.trim() !== (mine.bio ?? '')) {
        await updateBio(bio).unwrap()
      }
      await save({ hull, paddle, parked }).unwrap()
      onClose()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Sheet title={mine?.launched ? 'Your kayak' : 'Launch your kayak'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="relative -mx-2 flex h-36 items-center justify-center overflow-hidden rounded-3xl bg-[radial-gradient(120%_120%_at_30%_30%,#22C3CF,#06628A)]">
          <KayakArt hull={hull} paddle={paddle} className="h-[140%] rotate-90" />
        </div>

        {claiming ? (
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-xs text-sand/60">Handle</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-ui text-sm text-sand/40">@</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                className={cn(INPUT_CLASS, 'pl-8')}
                placeholder="tidewalker"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={3}
                maxLength={20}
              />
            </div>
            <span className="font-ui text-[11px] leading-snug text-sand/45">
              Permanent. Never linked to the bottles you throw.
            </span>
          </label>
        ) : (
          <p className="font-ui text-sm text-sand/70">@{mine.handle}</p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="font-ui text-xs text-sand/60">A line about you (optional)</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 280))}
            rows={3}
            className={cn(INPUT_CLASS, 'resize-none')}
            placeholder="Night swimmer. Collects sea glass."
          />
          <span className="self-end font-mono text-[10px] text-sand/35">{bio.length}/280</span>
        </label>

        <Swatches label="Hull" options={HULLS} colors={HULL_COLOR} value={hull} onChange={setHull} />
        <Swatches label="Paddle" options={PADDLES} colors={PADDLE_COLOR} value={paddle} onChange={setPaddle} />

        <div className="glass flex items-center justify-between gap-3 rounded-3xl px-4 py-3">
          <div>
            <p className="font-ui text-sm text-sand">Float in the Harbour</p>
            <p className="font-ui text-[11px] leading-snug text-sand/45">
              Twelve kayaks are chosen each day. Off pulls yours ashore.
            </p>
          </div>
          <Switch checked={parked} onChange={setParked} label="Float in the Harbour" />
        </div>

        {error && (
          <p role="alert" className="font-ui text-xs text-coral">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!handleOk || busy}
          className="press w-full rounded-full bg-seafoam py-3.5 font-ui text-sm font-semibold text-ocean-deep transition-[filter,opacity] hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Saving…' : mine?.launched ? 'Save' : 'Launch my kayak'}
        </button>
      </form>
    </Sheet>
  )
}

function Swatches<T extends string>({
  label,
  options,
  colors,
  value,
  onChange,
}: {
  label: string
  options: readonly T[]
  colors: Record<T, string>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-ui text-xs text-sand/60">{label}</legend>
      <div className="flex flex-wrap gap-2.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-label={`${label} ${o}`}
            aria-pressed={o === value}
            onClick={() => onChange(o)}
            className={cn(
              'press relative h-10 w-10 rounded-full shadow-[inset_0_-3px_6px_rgba(0,0,0,0.25)] ring-offset-2 ring-offset-ocean-mid transition-[box-shadow,transform]',
              o === value && 'ring-2 ring-sand/80',
            )}
            style={{ background: colors[o] }}
          >
            {o === value && (
              <Check
                size={16}
                strokeWidth={2.5}
                className={cn('absolute inset-0 m-auto', o === 'white' || o === 'yellow' || o === 'lime' ? 'text-black/60' : 'text-white/85')}
              />
            )}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
