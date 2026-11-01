'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'motion/react'
import { ChevronLeft, Flag, MoreHorizontal } from 'lucide-react'
import CheckedText, { useLiveCheck } from '@/components/harbour/CheckedText'
import GemArt from '@/components/harbour/GemArt'
import HarbourWater from '@/components/harbour/HarbourWater'
import KayakArt from '@/components/harbour/KayakArt'
import ConfirmButton from '@/components/ui/ConfirmButton'
import Sheet from '@/components/ui/Sheet'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { gemName } from '@/lib/gems/engine'
import { COMMENT_MAX, COMMENT_MIN, lightAt, type Light } from '@/lib/harbour'
import { cn } from '@/lib/utils'
import {
  useBlockVisitMutation,
  useGetHarbourQuery,
  useGetVisitQuery,
  useLeaveCommentMutation,
  useReportCommentMutation,
  useReportNoteMutation,
  useWaveOnMutation,
} from '@/store/api/bottleApi'
import { useCurrentSea } from '@/components/shared/useCurrentSea'
import WeatherLayer from '@/components/shared/WeatherLayer'
import type { ReportReason } from '@/types'

// A Kayak in your harbour (063): its note, its guestbook and its gems. One gem
// for a few words, and it sails on to the next harbour. Nobody is named here.

const REPORT_REASONS: [ReportReason, string][] = [
  ['sexual', 'Sexual'],
  ['harassment', 'Abusive'],
  ['spam', 'Spam'],
  ['contact', 'Contact info'],
  ['other', 'Other'],
]

const ERRORS: Record<string, string> = {
  content_not_allowed: 'That comment isn’t allowed here.',
  visit_over: 'This Kayak has already sailed on.',
  gem_gone: 'That gem is gone. Pick another.',
  account_suspended: 'Your account is suspended.',
  age_unconfirmed: 'Please confirm you’re 18 or older first.',
  keeper_only: 'Kayaks are for Keepers.',
}
const errorText = (err: unknown) => ERRORS[(err as { error?: string })?.error ?? ''] ?? 'Something went wrong. Try again.'

function ReportReasons({ onPick }: { onPick: (r: ReportReason) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Report reason">
      {REPORT_REASONS.map(([reason, label]) => (
        <button
          key={reason}
          type="button"
          onClick={() => onPick(reason)}
          className="press rounded-full bg-coral/15 px-3 py-1.5 font-ui text-xs font-medium text-coral transition-[background-color,transform] hover:bg-coral/25"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function VisitPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  // Always asked afresh: it may have sailed on since this was cached.
  const { data, isLoading, isError } = useGetVisitQuery(params.id, { refetchOnMountOrArgChange: true })
  const { data: harbour } = useGetHarbourQuery()
  const tint = useCurrentSea(harbour?.keeper ?? false)
  const [light, setLight] = useState<Light>('day')
  useEffect(() => setLight(lightAt(new Date().getHours())), [])

  const [gem, setGem] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<null | 'actions' | { comment: string }>(null)

  const { check, blocked, gate } = useLiveCheck(body)
  const [leave] = useLeaveCommentMutation()
  const [wave] = useWaveOnMutation()
  const [reportNote] = useReportNoteMutation()
  const [reportComment] = useReportCommentMutation()
  const [block] = useBlockVisitMutation()

  const text = body.trim()
  const ready = !!gem && text.length >= COMMENT_MIN && !blocked && !busy
  const chosen = data?.gems.find((g) => g.id === gem)

  async function act(run: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await run()
      setSheet(null)
      router.push('/harbour')
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  async function send() {
    if (!ready || !gem) return
    setBusy(true)
    setError(null)
    if (!(await gate())) {
      setBusy(false)
      return
    }
    await act(() => leave({ visit: params.id, gem, body: text }).unwrap())
  }

  return (
    <div className="relative h-full overflow-hidden">
      <HarbourWater light={light} zoom={2.6} tint={tint} />
      {tint && <WeatherLayer weather={tint.weather} />}
      <div className="absolute inset-0 overflow-y-auto px-4 pb-32 pt-16">
        <div className="mx-auto flex max-w-lg flex-col gap-4">
          <div className="flex items-center justify-between">
            <TransitionLink
              href="/harbour"
              className="press inline-flex h-9 items-center gap-1 rounded-full bg-black/25 pl-2 pr-4 font-ui text-xs text-white backdrop-blur-md"
            >
              <ChevronLeft size={16} aria-hidden="true" /> Harbour
            </TransitionLink>
            {data && !isError && (
              <button
                type="button"
                onClick={() => setSheet('actions')}
                aria-label="Report or block"
                className="press inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md"
              >
                <MoreHorizontal size={18} aria-hidden="true" />
              </button>
            )}
          </div>

          {isError && (
            <div className="rounded-3xl glass-strong px-5 py-4 text-center">
              <p className="font-ui text-sm text-sand/80">This Kayak has already sailed on.</p>
              <TransitionLink href="/harbour" className="press mt-2 inline-block font-ui text-xs text-seafoam">
                Back to the Harbour
              </TransitionLink>
            </div>
          )}

          {data && !isLoading && !isError && (
            <>
              <div className="flex justify-center" style={{ viewTransitionName: `visit-${params.id}` }}>
                <KayakArt look={data.look} aboard={data.gems.length} className="h-60 w-48 drop-shadow-[0_8px_18px_rgba(0,20,30,0.45)]" />
              </div>

              <h1 className="sr-only">A visiting Kayak</h1>
              <blockquote className="-rotate-1 rounded-lg bg-[#FBF3E4] px-5 py-4 font-display text-lg leading-snug text-[#2A2622] shadow-[0_6px_16px_rgba(0,0,0,0.3)]">
                {data.note}
              </blockquote>

              <section className="rounded-3xl glass-strong p-4">
                <h2 className="font-ui text-xs font-medium text-sand/70">
                  {data.guestbook.length === 0 ? 'Nobody has answered yet' : 'Others have written'}
                </h2>
                {data.guestbook.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-2">
                    {data.guestbook.map((c) => (
                      <li key={c.id} className="flex items-start gap-2 rounded-2xl bg-black/15 px-3 py-2">
                        <p className="flex-1 font-ui text-sm leading-relaxed text-sand/85">{c.body}</p>
                        <button
                          type="button"
                          aria-label="Report this comment"
                          onClick={() => setSheet({ comment: c.id })}
                          className="press mt-0.5 shrink-0 text-sand/35 hover:text-coral"
                        >
                          <Flag size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="flex flex-col gap-3 rounded-3xl glass-strong p-4">
                <div>
                  <h2 className="font-ui text-xs font-medium text-sand/70">Choose one to keep</h2>
                  <p className="mt-0.5 min-h-4 font-display text-sm text-sand">{chosen ? gemName(chosen.seed) : ''}</p>
                </div>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6" role="radiogroup" aria-label="Gems aboard">
                  {data.gems.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      role="radio"
                      aria-checked={g.id === gem}
                      aria-label={gemName(g.seed)}
                      onClick={() => setGem(g.id)}
                      className={cn(
                        'press rounded-2xl p-1 transition-[background-color,box-shadow]',
                        g.id === gem ? 'bg-white/15 ring-2 ring-seafoam' : 'hover:bg-white/5',
                      )}
                    >
                      <GemArt seed={g.seed} className="aspect-square w-full" />
                    </button>
                  ))}
                </div>

                <CheckedText
                  value={body}
                  onChange={setBody}
                  check={check}
                  label="In return, a few words"
                  placeholder="Answer the note, kindly. It stays anonymous."
                  max={COMMENT_MAX}
                  crisisLead="This won’t be shared with anyone."
                />
                {error && (
                  <p role="alert" className="font-ui text-xs text-coral">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={send}
                  disabled={!ready}
                  className="press w-full rounded-full bg-seafoam py-3.5 font-ui text-sm font-semibold text-ocean-deep transition-[filter,opacity] hover:brightness-110 disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Keep it and send it on'}
                </button>
                <p className="text-center font-ui text-[11px] text-sand/45">
                  Everyone who gets this Kayak next can read what you write.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => wave(params.id).unwrap())}
                  className="press font-ui text-xs text-sand/60 underline underline-offset-2"
                >
                  Let it sail, without taking anything
                </button>
              </section>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {sheet === 'actions' && (
          <Sheet title="This Kayak" onClose={() => setSheet(null)}>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <p className="font-ui text-xs text-sand/60">
                  Report the note: the Kayak goes home, a moderator looks, and it won&rsquo;t come back to you.
                </p>
                <ReportReasons onPick={(reason) => act(() => reportNote({ visit: params.id, reason }).unwrap())} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-4">
                <p className="font-ui text-xs text-sand/60">Block: this person&rsquo;s Kayaks stay away, and yours stay away from them.</p>
                <ConfirmButton
                  confirmLabel="Block?"
                  onConfirm={() => act(() => block(params.id).unwrap())}
                  className="shrink-0 rounded-full bg-white/10 px-4 py-1.5 font-ui text-xs text-sand"
                >
                  Block
                </ConfirmButton>
              </div>
              {error && (
                <p role="alert" className="font-ui text-xs text-coral">
                  {error}
                </p>
              )}
            </div>
          </Sheet>
        )}
        {sheet && sheet !== 'actions' && (
          <Sheet title="Report this comment" onClose={() => setSheet(null)}>
            <div className="flex flex-col gap-2">
              <p className="font-ui text-xs text-sand/60">It disappears for everyone while a moderator looks.</p>
              <ReportReasons
                onPick={async (reason) => {
                  setError(null)
                  try {
                    if (!(await reportComment({ comment: sheet.comment, reason }).unwrap())) throw new Error()
                    setSheet(null)
                  } catch {
                    setError('That report didn’t go through. Try again.')
                  }
                }}
              />
              {error && (
                <p role="alert" className="font-ui text-xs text-coral">
                  {error}
                </p>
              )}
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  )
}
