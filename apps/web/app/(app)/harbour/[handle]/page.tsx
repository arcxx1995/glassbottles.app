'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'
import HarbourWater from '@/components/harbour/HarbourWater'
import KayakArt from '@/components/harbour/KayakArt'
import KayakEditor from '@/components/harbour/KayakEditor'
import Sheet from '@/components/ui/Sheet'
import ConfirmButton from '@/components/ui/ConfirmButton'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { spring } from '@/components/ui/springs'
import { useBlockKayakMutation, useGetHarbourQuery, useReportKayakMutation } from '@/store/api/bottleApi'
import { lightAt, type Light } from '@/lib/harbour'
import type { ReportReason } from '@/types'

// Inside a kayak: the same kayak from the ring, close up and upright (the
// view transition morphs one into the other). Its handle is painted along
// the hull; its bio is a note left on the seat. Only today's twelve and your
// own kayak can be visited.

const REPORT_REASONS: [ReportReason, string][] = [
  ['sexual', 'Sexual'],
  ['harassment', 'Abusive'],
  ['spam', 'Spam'],
  ['contact', 'Contact info'],
  ['other', 'Other'],
]

export default function KayakPage({ params }: { params: { handle: string } }) {
  const handle = decodeURIComponent(params.handle).toLowerCase()
  const router = useRouter()
  const { data, isLoading } = useGetHarbourQuery()
  const [light, setLight] = useState<Light>('day')
  const [sheet, setSheet] = useState<null | 'actions' | 'edit'>(null)
  const [report] = useReportKayakMutation()
  const [block] = useBlockKayakMutation()
  const [failed, setFailed] = useState(false)

  useEffect(() => setLight(lightAt(new Date().getHours())), [])

  const mine = data?.mine?.handle === handle ? data.mine : null
  const theirs = data?.kayaks.find((k) => k.handle === handle && !k.mine)
  const kayak = mine?.launched && mine.hull && mine.paddle
    ? { handle, bio: mine.bio, hull: mine.hull, paddle: mine.paddle }
    : theirs

  async function act(run: () => Promise<unknown>) {
    setFailed(false)
    try {
      await run()
      setSheet(null)
      router.push('/harbour')
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="relative h-full overflow-hidden">
      <HarbourWater light={light} zoom={2.6} />

      <header className="relative z-10 flex items-center justify-between px-4 pt-5">
        <TransitionLink
          href="/harbour"
          className="press inline-flex h-9 items-center gap-1 rounded-full bg-black/25 pl-2 pr-4 font-ui text-xs text-white backdrop-blur-md"
        >
          <ChevronLeft size={16} aria-hidden="true" /> Harbour
        </TransitionLink>
        {kayak && (
          mine ? (
            <button
              type="button"
              onClick={() => setSheet('edit')}
              className="press h-9 rounded-full bg-black/25 px-4 font-ui text-xs font-medium text-white backdrop-blur-md"
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSheet('actions')}
              aria-label="Report or block"
              className="press inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md"
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
          )
        )}
      </header>

      {kayak ? (
        <div className="absolute inset-0 flex items-center justify-center pt-8">
          <div
            className="relative"
            style={{ height: 'min(calc(100svh - 10rem), 900px)', aspectRatio: '2 / 3', viewTransitionName: `kayak-${handle}` }}
          >
            <KayakArt hull={kayak.hull} paddle={kayak.paddle} lantern={light === 'night'} className="h-full w-full drop-shadow-[0_8px_18px_rgba(0,20,30,0.45)]" />
            {/* The handle, painted along the hull like a maker's decal. */}
            <svg viewBox="0 0 200 300" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              <text
                transform="translate(77 262) rotate(-90)"
                fontSize="7.5"
                letterSpacing="1.2"
                fontFamily="var(--font-ui), system-ui, sans-serif"
                fontWeight="600"
                fill={kayak.hull === 'white' || kayak.hull === 'yellow' || kayak.hull === 'lime' ? '#1C1E22' : '#FFFFFF'}
                fillOpacity="0.7"
              >
                @{kayak.handle}
              </text>
            </svg>
            <h1 className="sr-only">@{kayak.handle}</h1>
            {kayak.bio && (
              // Centred by the wrapper: motion owns the note's transform.
              <div className="absolute inset-x-0 top-[51%] flex justify-center">
                <motion.p
                  initial={{ opacity: 0, y: 10, rotate: -6 }}
                  animate={{ opacity: 1, y: 0, rotate: -3 }}
                  transition={{ ...spring, delay: 0.25 }}
                  className="w-[min(260px,78vw)] rounded-lg bg-[#FBF3E4] px-4 py-3 font-display text-[15px] leading-snug text-[#2A2622] shadow-[0_6px_16px_rgba(0,0,0,0.3)]"
                >
                  {kayak.bio}
                </motion.p>
              </div>
            )}
          </div>
        </div>
      ) : (
        !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="max-w-xs rounded-3xl glass-strong px-5 py-4 text-center">
              <p className="font-ui text-sm text-sand/80">This kayak isn&rsquo;t in today&rsquo;s harbour.</p>
              <TransitionLink href="/harbour" className="press mt-2 inline-block font-ui text-xs text-seafoam">
                Back to the Harbour
              </TransitionLink>
            </div>
          </div>
        )
      )}

      <AnimatePresence>
        {sheet === 'edit' && mine && <KayakEditor mine={mine} onClose={() => setSheet(null)} />}
        {sheet === 'actions' && kayak && (
          <Sheet title={`@${kayak.handle}`} onClose={() => setSheet(null)}>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <p className="font-ui text-xs text-sand/60">Report — this kayak disappears for you, and a moderator takes a look.</p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Report reason">
                  {REPORT_REASONS.map(([reason, label]) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => act(() => report({ handle: kayak.handle, reason }).unwrap())}
                      className="press rounded-full bg-coral/15 px-3 py-1.5 font-ui text-xs font-medium text-coral transition-[background-color,transform] hover:bg-coral/25"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-4">
                <p className="font-ui text-xs text-sand/60">Block — neither of you sees the other&rsquo;s kayak.</p>
                <ConfirmButton
                  confirmLabel="Block?"
                  onConfirm={() => act(() => block({ handle: kayak.handle, block: true }).unwrap())}
                  className="shrink-0 rounded-full bg-white/10 px-4 py-1.5 font-ui text-xs text-sand"
                >
                  Block
                </ConfirmButton>
              </div>
              {failed && (
                <p role="alert" className="font-ui text-xs text-coral">
                  That didn&rsquo;t go through. Try again.
                </p>
              )}
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  )
}
