'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Bookmark, Flag, CheckCheck, Sparkles } from 'lucide-react'
import {
  useGetAtelierQuery,
  useGetKeeperQuery,
  useMarkBottleReadMutation,
  useReportBottleMutation,
  useRippleBottleMutation,
  useKeepBottleMutation,
} from '@/store/api/bottleApi'
import { CURRENT_INFO, VIBE_LABEL, WEATHER_LABEL, bottleLook } from '@/lib/dressing'
import { BottleSVG, LIFT_TRANSITION } from '@/components/bottle/ThrowAnimation'
import KeeperPlans from '@/components/keeper/KeeperPlans'
import Sheet from '@/components/ui/Sheet'
import { feel } from '@/lib/feel'
import { easeOut, springFlick } from '@/components/ui/springs'
import type { Bottle, ReportReason } from '@/types'

interface ReceivedBottleProps {
  bottle: Bottle
  /** Called once a report settles: true = removed for good, false = failed. */
  onReported?: (ok: boolean) => void
}

// Picking a reason IS the confirm step: one tap reports and removes.
const REPORT_REASONS: [ReportReason, string][] = [
  ['sexual', 'Sexual'],
  ['harassment', 'Abusive'],
  ['spam', 'Spam'],
  ['contact', 'Contact info'],
  ['other', 'Other'],
]

// uncorking → open. A bottle opened for the first time loses its cork, then its
// note unrolls and the words arrive; opening IS reading, so there is no "Mark
// read" step. Later opens, and reduced motion, go straight to the note. Tap the
// note mid-reveal to show all of it.
type Stage = 'uncorking' | 'open'
const UNCORK_DELAY = 300 // ms: the lift off the shelf takes about this long

export default function ReceivedBottle({ bottle, onReported }: ReceivedBottleProps) {
  const [markRead] = useMarkBottleReadMutation()
  const [reportBottle, { isLoading: isReporting }] = useReportBottleMutation()
  const [ripple] = useRippleBottleMutation()
  const [keep] = useKeepBottleMutation()
  const kept = !!bottle.kept_at
  // Only Keepers get `style` from the server (057); theirs is bottleLook's
  // to fill in when the sender didn't dress it.
  const keeperOn = process.env.NEXT_PUBLIC_KEEPER === 'on'
  const { data: keeper } = useGetKeeperQuery(undefined, { skip: !keeperOn })
  const { data: pieces } = useGetAtelierQuery()
  const look = bottleLook(bottle, pieces, !!keeper?.isKeeper)
  const tags = [
    bottle.weather && `${WEATHER_LABEL[bottle.weather]} sky`,
    bottle.vibe && VIBE_LABEL[bottle.vibe],
    bottle.current && CURRENT_INFO[bottle.current].name,
  ].filter(Boolean) as string[]
  const reduced = useReducedMotion() ?? false

  // Frozen at mount: the optimistic is_read flip on open must not cut the
  // reveal short by re-rendering the card as history.
  const [reveal] = useState(!bottle.is_read)
  const [stage, setStage] = useState<Stage>(reveal && !reduced ? 'uncorking' : 'open')
  const [confirmingReport, setConfirmingReport] = useState(false)
  const [skipReveal, setSkipReveal] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)

  useEffect(() => {
    if (stage !== 'uncorking') return
    feel('pop')
    // Long enough for the bottle to land from the shelf, then lose its cork.
    const t = setTimeout(() => setStage('open'), UNCORK_DELAY + 650)
    return () => clearTimeout(t)
  }, [stage])

  // Once per mount: a failed read rolls the optimistic flag back, and retrying
  // on that would loop. The next open tries again.
  const markedRef = useRef(false)
  useEffect(() => {
    if (bottle.is_read || markedRef.current) return
    markedRef.current = true
    void markRead(bottle.id)
  }, [bottle.is_read, bottle.id, markRead])

  function confirmReport(reason: ReportReason) {
    setConfirmingReport(false)
    reportBottle({ bottleId: bottle.id, reason })
      .unwrap()
      .then(() => onReported?.(true))
      .catch(() => onReported?.(false))
  }

  // The staggered word reveal is the moment a message is FIRST read — it costs
  // one motion node per word (~180 for a full-length bottle). History renders
  // as plain text; only the bottle being opened animates.
  const lines = reveal && !reduced && !skipReveal
    ? bottle.message.split('\n').map((line) => line.split(' '))
    : []
  const lineOffsets: number[] = []
  let wordCount = 0
  for (const line of lines) {
    lineOffsets.push(wordCount)
    wordCount += line.length
  }

  return (
    <article
      className="relative rounded-card border border-border-subtle p-5"
      style={{ background: look.paper }}
    >
      {/* Keepsake (045): free, unlimited, the receiver's alone. */}
      {stage === 'open' && (
        <button
          type="button"
          onClick={() => void keep({ id: bottle.id, keep: !kept })}
          aria-pressed={kept}
          aria-label={kept ? 'Kept — tap to let go' : 'Keep this bottle'}
          title={kept ? 'Kept' : 'Keep'}
          className={`press absolute right-3 top-3 z-10 p-2 rounded-xl transition-[color,transform] ${
            kept ? 'text-seafoam' : 'text-sand/40 hover:text-sand/60'
          }`}
        >
          <Bookmark size={16} strokeWidth={1.5} fill={kept ? 'currentColor' : 'none'} />
        </button>
      )}
      {/* The bottle that lifted off the shelf: tapping it again does nothing, the
          note below is what you came for. */}
      <div className="mb-4 flex justify-center">
        <motion.div
          className="relative"
          style={{ viewTransitionName: LIFT_TRANSITION }}
          animate={stage === 'uncorking' ? { rotate: [0, -9, 7, -3, 0] } : undefined}
          transition={{ duration: 0.5, ease: 'easeInOut', delay: UNCORK_DELAY / 1000 }}
        >
          <BottleSVG width={64} height={96} corked={false} glowing={stage === 'uncorking'} look={look} />
          {/* Cork, positioned over the neck of the 64×96 bottle (0.8× its
              80×120 viewBox), so it can pop free. */}
          {reveal && !reduced && (
            <motion.span
              aria-hidden
              className="absolute left-1/2 top-[2.4px] block h-[10.4px] w-[20.8px] -translate-x-1/2 rounded-[3.2px]"
              style={{ background: look.wax ?? '#C4A882' }}
              initial={{ y: 0, x: 0, rotate: 0, opacity: 1 }}
              animate={{ y: -28, x: 12, rotate: 55, opacity: 0 }}
              // The cork is the one thing here with momentum: it gets the bounce.
              transition={{
                ...springFlick,
                delay: UNCORK_DELAY / 1000,
                opacity: { duration: 0.3, delay: UNCORK_DELAY / 1000 + 0.12 },
              }}
            />
          )}
        </motion.div>
      </div>
      <AnimatePresence initial={false}>
        {stage === 'open' && (
          <motion.div
            key="open"
            // The note unrolls downward out of the bottle.
            initial={reveal && !reduced ? { clipPath: 'inset(0 0 100% 0)', opacity: 0.4 } : false}
            animate={{ clipPath: 'inset(0 0 0% 0)', opacity: 1 }}
            transition={{ duration: 0.55, ease: easeOut }}
          >
            <div className="mb-5">
              {tags.length > 0 && (
                <p className="mb-3 font-ui text-[11px] uppercase tracking-widest text-sand/35">
                  {tags.join(' · ')}
                </p>
              )}
              <p
                className="font-display text-lg leading-relaxed"
                style={{ color: look.ink }}
                aria-label="Message content"
                onClick={lines.length > 0 ? () => setSkipReveal(true) : undefined}
              >
                {lines.length === 0 && (
                  <span className="whitespace-pre-line">{bottle.message}</span>
                )}
                {lines.map((line, li) => (
                  <span key={li} className="block min-h-[1em]">
                    {line.map((word, wi) => {
                      const i = lineOffsets[li] + wi
                      return (
                        <motion.span
                          key={wi}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            delay: 0.15 + Math.min(i * 0.025, 1.4),
                            duration: 0.28,
                            ease: 'easeOut',
                          }}
                          className="inline-block mr-[0.28em]"
                        >
                          {word}
                        </motion.span>
                      )
                    })}
                  </span>
                ))}
              </p>
              {keeperOn && bottle.dressed && !bottle.style && (
                <button
                  type="button"
                  onClick={() => setPlansOpen(true)}
                  className="press mt-4 block text-left font-ui text-xs text-sand/50 hover:text-sand/80 transition-[color,transform]"
                >
                  This bottle was dressed. Keepers see it as sent.
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="flex min-h-[36px] flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/5">
        {confirmingReport ? (
          <div className="flex w-full flex-col gap-2 py-1">
            <div className="flex items-center justify-between gap-2">
              <p className="font-ui text-xs text-sand/60">Report and remove — what&rsquo;s wrong?</p>
              <button
                type="button"
                onClick={() => setConfirmingReport(false)}
                className="press px-3 py-1.5 rounded-xl font-ui text-xs text-sand/50 hover:text-sand/80 transition-[color,transform]"
              >
                Cancel
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Report reason">
              {REPORT_REASONS.map(([reason, label]) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => confirmReport(reason)}
                  className="press px-3 py-1.5 rounded-full bg-coral/15 text-coral font-ui text-xs font-medium hover:bg-coral/25 transition-[background-color,transform]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <time dateTime={bottle.sent_at} className="whitespace-nowrap font-mono text-xs text-sand/45">
              {/* "Sent": the tag on the shelf shows when it arrived. */}
              Sent{' '}
              {new Date(bottle.sent_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </time>

            <div className="flex items-center gap-2">
              {stage === 'open' && (
                <span className="font-ui text-xs text-sand/40 flex items-center gap-1">
                  <CheckCheck size={13} strokeWidth={1.5} />
                  Read
                </span>
              )}
              {/* The one thing a receiver can send back (044): no words, no
                  name — just that it landed. Once per bottle. */}
              {stage === 'open' &&
                (bottle.rippled_at ? (
                  <span className="font-ui text-xs text-seafoam/70 flex items-center gap-1">
                    <Sparkles size={13} strokeWidth={1.5} />
                    They&rsquo;ll know
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      feel('chime')
                      void ripple(bottle.id)
                    }}
                    className="press whitespace-nowrap px-3 py-1.5 rounded-full border border-seafoam/25 text-seafoam/85 font-ui text-xs hover:bg-seafoam/10 transition-[background-color,transform] flex items-center gap-1"
                  >
                    <Sparkles size={13} strokeWidth={1.5} />
                    This reached me
                  </button>
                ))}

              <button
                type="button"
                onClick={() => setConfirmingReport(true)}
                disabled={isReporting}
                className="press p-2 rounded-xl text-sand/40 hover:text-coral/80 transition-[color,transform]
                           disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Report this bottle"
                title="Report"
              >
                <Flag size={15} strokeWidth={1.5} />
              </button>
            </div>
          </>
        )}
      </div>
      <AnimatePresence>
        {plansOpen && (
          <Sheet title="Become a Keeper" onClose={() => setPlansOpen(false)}>
            <KeeperPlans returnTo="shelf" />
          </Sheet>
        )}
      </AnimatePresence>
    </article>
  )
}
