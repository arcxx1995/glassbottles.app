'use client'

import { useMemo } from 'react'
import { useLogbook } from './useLogbook'
import { Hourglass, Printer, Sparkles } from 'lucide-react'
import KeeperPlans from '@/components/keeper/KeeperPlans'
import { useGetAtelierQuery, useGetKeeperQuery } from '@/store/api/bottleApi'
import { CURRENT_INFO, VIBE_LABEL, WEATHER_LABEL, resolveLook, type BottleStyle, type CurrentId, type Vibe, type Weather } from '@/lib/dressing'

// The Logbook (migration 048): every bottle you threw, every one that found
// you, and your letters to yourself, by year and month. Keepers (and anyone
// who has been one) can read it; an active Keeper can save it as a PDF —
// the browser's own print-to-PDF, styled plain by the print rules.

type Kind = 'sent' | 'received' | 'future'
interface Entry {
  kind: Kind
  message: string
  at: string
  style?: BottleStyle | null
  weather?: Weather | null
  vibe?: Vibe | null
  current?: CurrentId | null
  found?: boolean
  rippled?: boolean
  kept?: boolean
  written?: string
}

const KIND_LABEL: Record<Kind, string> = {
  sent: 'You threw',
  received: 'Found you',
  future: 'From you, to you',
}

export default function LogbookPage() {
  const { data: keeper } = useGetKeeperQuery()
  const { data: log, isLoading, error } = useLogbook()
  const { data: pieces } = useGetAtelierQuery()

  const years = useMemo(() => {
    if (!log) return []
    const all: Entry[] = [
      ...log.sent.map((e) => ({ ...e, kind: 'sent' as const })),
      ...log.received.map((e) => ({ ...e, kind: 'received' as const })),
      ...log.future.map((e) => ({ ...e, kind: 'future' as const })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    const byYear = new Map<number, Entry[]>()
    for (const e of all) {
      const y = new Date(e.at).getFullYear()
      byYear.set(y, [...(byYear.get(y) ?? []), e])
    }
    return [...byYear.entries()]
  }, [log])

  const locked = error === 'keeper_only'

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 pt-10 pb-24 sm:pt-14 print:h-auto print:overflow-visible print:p-0 print:text-black">
      <div className="mx-auto w-full max-w-xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-title text-sand print:text-black">Logbook</h1>
            <p className="font-ui text-sm text-sand/40 mt-1 print:text-black/60">
              Every bottle you threw, and every one that found you.
            </p>
          </div>
          {log && keeper?.isKeeper && (
            <button
              type="button"
              onClick={() => window.print()}
              className="press print:hidden shrink-0 flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 font-ui text-xs text-sand/70 hover:text-sand hover:border-white/20 transition-[color,border-color,transform]"
            >
              <Printer size={14} strokeWidth={1.5} />
              Save as PDF
            </button>
          )}
        </div>

        {isLoading && <div className="h-40 rounded-3xl skeleton" />}

        {error === 'failed' && (
          <p className="font-ui text-sm text-sand/50" role="alert">
            Couldn&rsquo;t open your Logbook. Check your connection and try again.
          </p>
        )}

        {locked && (
          <div className="rounded-3xl glass-tint p-5 flex flex-col gap-3">
            <p className="font-display text-lg text-sand">A keepsake of your sea</p>
            <p className="font-ui text-sm text-sand/55 leading-relaxed">
              The Logbook gathers every bottle you&rsquo;ve thrown and every one that found you,
              year by year, ready to save as a PDF. It&rsquo;s for Keepers, and it stays yours
              to read even if you stop.
            </p>
            <KeeperPlans />
          </div>
        )}

        {log && !keeper?.isKeeper && (
          <p className="print:hidden mb-4 rounded-2xl border border-white/10 px-4 py-3 font-ui text-xs text-sand/55">
            Your Logbook stays yours to read. Rejoin Keeper to save it as a PDF.
          </p>
        )}

        {log && years.length === 0 && (
          <p className="font-ui text-sm text-sand/40">Nothing here yet. Your first bottle starts it.</p>
        )}

        {years.map(([year, entries]) => (
          <section key={year} className="mb-8">
            <h2 className="font-display text-xl text-sand/80 mb-3 print:text-black">{year}</h2>
            <div className="flex flex-col gap-3">
              {entries.map((e, i) => {
                const look = resolveLook(e.style, pieces)
                const tags = [
                  e.weather && `${WEATHER_LABEL[e.weather]} sky`,
                  e.vibe && VIBE_LABEL[e.vibe],
                  e.current && CURRENT_INFO[e.current].name,
                ].filter(Boolean)
                return (
                  <article
                    key={i}
                    className="rounded-2xl border border-white/10 p-4 break-inside-avoid bg-[var(--paper)] print:bg-transparent print:border-black/20"
                    style={{ ['--paper' as string]: look.paper, ['--ink' as string]: look.ink }}
                  >
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[11px] uppercase tracking-widest text-sand/40 mb-2 print:text-black/60">
                      {e.kind === 'future' && <Hourglass size={11} strokeWidth={1.5} />}
                      <span>{KIND_LABEL[e.kind]}</span>
                      <span>·</span>
                      <time dateTime={e.at}>
                        {new Date(e.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                      </time>
                      {tags.length > 0 && <span>· {tags.join(' · ')}</span>}
                      {e.kind === 'sent' && <span>· {e.found ? 'found' : 'still drifting'}</span>}
                      {e.rippled && (
                        <span className="flex items-center gap-1 text-seafoam/70 print:text-black/60">
                          · <Sparkles size={11} strokeWidth={1.5} /> reached someone
                        </span>
                      )}
                      {e.kept && <span>· kept</span>}
                    </p>
                    <p className="font-display text-base leading-relaxed whitespace-pre-line text-[color:var(--ink)] print:text-black">
                      {e.message}
                    </p>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
