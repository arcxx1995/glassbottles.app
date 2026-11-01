'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import GemArt from '@/components/harbour/GemArt'
import HarbourWater from '@/components/harbour/HarbourWater'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { gemName } from '@/lib/gems/engine'
import { lightAt, type Light } from '@/lib/harbour'
import { useCurrentSea } from '@/components/shared/useCurrentSea'
import WeatherLayer from '@/components/shared/WeatherLayer'
import { useGetHarbourQuery, useGetTreasureQuery } from '@/store/api/bottleApi'

// The treasure room (063): every gem you've kept, and what you wrote for it.
// Yours for good, whether or not you're still a Keeper.

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export default function TreasurePage() {
  const { data, isLoading, isError, refetch } = useGetTreasureQuery(undefined, { refetchOnMountOrArgChange: true })
  const { data: harbour } = useGetHarbourQuery()
  const tint = useCurrentSea(harbour?.keeper ?? false)
  const [light, setLight] = useState<Light>('day')
  useEffect(() => setLight(lightAt(new Date().getHours())), [])

  return (
    <div className="relative h-full overflow-hidden">
      <HarbourWater light={light} zoom={2.6} tint={tint} />
      {tint && <WeatherLayer weather={tint.weather} />}
      <div className="absolute inset-0 overflow-y-auto px-4 pb-32 pt-16">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <TransitionLink
            href="/harbour"
            className="press inline-flex h-9 w-fit items-center gap-1 rounded-full bg-black/25 pl-2 pr-4 font-ui text-xs text-white backdrop-blur-md"
          >
            <ChevronLeft size={16} aria-hidden="true" /> Harbour
          </TransitionLink>
          <div className="rounded-3xl glass-strong p-5">
            <h1 className="font-display text-2xl text-sand">Treasure room</h1>
            <p className="mt-1 font-ui text-xs text-sand/55">No two of these exist anywhere else.</p>

            {isError && (
              <button type="button" onClick={() => refetch()} className="press mt-4 font-ui text-xs text-seafoam underline">
                Couldn&rsquo;t open it. Try again
              </button>
            )}
            {!isLoading && !isError && data?.length === 0 && (
              <p className="mt-6 font-ui text-sm leading-relaxed text-sand/60">
                Nothing here yet. When a Kayak visits your harbour, you can keep one of its gems in return for a few words.
              </p>
            )}
            <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data?.map((g) => (
                <li key={g.id} className="flex gap-3 rounded-2xl bg-black/15 p-3">
                  <GemArt seed={g.seed} className={g.state === 'kept' ? 'h-20 w-20 shrink-0' : 'h-20 w-20 shrink-0 opacity-50'} />
                  <div className="min-w-0">
                    <p className="font-display text-base leading-tight text-sand">{gemName(g.seed)}</p>
                    <p className="mt-0.5 font-ui text-[11px] text-sand/45">
                      {g.state === 'kept' && g.kept_at ? `Found ${when(g.kept_at)}` : 'On its way to you'}
                    </p>
                    {g.comment && <p className="mt-1.5 font-ui text-xs leading-relaxed text-sand/70">&ldquo;{g.comment}&rdquo;</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
