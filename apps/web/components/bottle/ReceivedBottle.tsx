'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { Bookmark, Flag, CheckCheck, Sparkles } from 'lucide-react'
import {
  useGetAtelierQuery,
  useMarkBottleReadMutation,
  useReportBottleMutation,
  useRippleBottleMutation,
  useKeepBottleMutation,
} from '@/store/api/bottleApi'
import { CURRENT_INFO, VIBE_LABEL, WEATHER_LABEL, resolveLook } from '@/lib/dressing'
import { BottleSVG } from '@/components/bottle/ThrowAnimation'
import { feel } from '@/lib/feel'
import type { Bottle } from '@/types'

interface ReceivedBottleProps {
  bottle: Bottle
  /** Called once a report settles: true = removed for good, false = failed. */
  onReported?: (ok: boolean) => void
}

const EASE = [0.25, 0.46, 0.45, 0.94] as const

// sealed → uncorking → open. A bottle that arrives unread starts sealed and
// opens itself the first time it is properly on screen — opening IS reading,
// so there is no "Mark read" step. Reduced motion skips straight to open.
type Stage = 'sealed' | 'uncorking' | 'open'

export default function ReceivedBottle({ bottle, onReported }: ReceivedBottleProps) {
  const [markRead] = useMarkBottleReadMutation()
  const [reportBottle, { isLoading: isReporting }] = useReportBottleMutation()
  const [ripple] = useRippleBottleMutation()
  const [keep] = useKeepBottleMutation()
  const kept = !!bottle.kept_at
  // How the stranger dressed it (042) — glass and seal while sealed, then
  // their paper and ink once it opens.
  const { data: pieces } = useGetAtelierQuery()
  const look = resolveLook(bottle.style, pieces)
  const tags = [
    bottle.weather && `${WEATHER_LABEL[bottle.weather]} sky`,
    bottle.vibe && VIBE_LABEL[bottle.vibe],
    bottle.current && CURRENT_INFO[bottle.current].name,
  ].filter(Boolean) as string[]
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })

  // Frozen at mount: the optimistic is_read flip on open must not cut the
  // reveal short by re-rendering the card as history.
  const [reveal] = useState(!bottle.is_read)
  const [stage, setStage] = useState<Stage>(reveal && !reduced ? 'sealed' : 'open')
  const [confirmingReport, setConfirmingReport] = useState(false)

  useEffect(() => {
    if (inView && stage === 'sealed') {
      setStage('uncorking')
      feel('pop')
    }
  }, [inView, stage])

  useEffect(() => {
    if (stage !== 'uncorking') return
    const t = setTimeout(() => setStage('open'), 650)
    return () => clearTimeout(t)
  }, [stage])

  // Once per mount: a failed read rolls the optimistic flag back, and retrying
  // on that would loop. The next visit to the inbox tries again.
  const markedRef = useRef(false)
  useEffect(() => {
    if (stage !== 'open' || !inView || bottle.is_read || markedRef.current) return
    markedRef.current = true
    void markRead(bottle.id)
  }, [stage, inView, bottle.is_read, bottle.id, markRead])

  function confirmReport() {
    setConfirmingReport(false)
    reportBottle(bottle.id)
      .unwrap()
      .then(() => onReported?.(true))
      .catch(() => onReported?.(false))
  }

  // The staggered word reveal is the moment a message is FIRST read — it costs
  // one motion node per word (~180 for a full-length bottle). History renders
  // as plain text; only the bottle being opened animates.
  const lines = reveal && !reduced
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
      ref={ref}
      className="relative rounded-card border border-border-subtle p-6 mx-4 shadow-card"
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
          className={`absolute right-3 top-3 z-10 p-2 rounded-xl transition-colors ${
            kept ? 'text-seafoam' : 'text-sand/25 hover:text-sand/60'
          }`}
        >
          <Bookmark size={16} strokeWidth={1.5} fill={kept ? 'currentColor' : 'none'} />
        </button>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {stage !== 'open' ? (
          <motion.div
            key="sealed"
            className="flex flex-col items-center gap-3 py-6"
            exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }}
          >
            <motion.div
              className="relative"
              animate={stage === 'uncorking' ? { rotate: [0, -9, 7, -3, 0] } : { y: [0, -3, 0] }}
              transition={
                stage === 'uncorking'
                  ? { duration: 0.5, ease: 'easeInOut' }
                  : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
              }
            >
              <BottleSVG width={48} height={72} corked={false} glowing look={look} />
              {/* Cork, positioned over the neck of the 48×72 bottle (0.6× its
                  80×120 viewBox), so it can pop free. */}
              <motion.span
                aria-hidden
                className="absolute left-1/2 top-[1.8px] block h-[7.8px] w-[15.6px] -translate-x-1/2 rounded-[2.4px]"
                style={{ background: look.wax ?? '#C4A882' }}
                animate={
                  stage === 'uncorking'
                    ? { y: -28, x: 12, rotate: 55, opacity: 0 }
                    : { y: 0, x: 0, rotate: 0, opacity: 1 }
                }
                transition={{ duration: 0.45, ease: [0.2, 0.8, 0.3, 1] }}
              />
            </motion.div>
            <p className="font-ui text-xs text-sand/45">A bottle washed ashore</p>
          </motion.div>
        ) : (
          <motion.div
            key="open"
            // The note unrolls downward out of the bottle.
            initial={reveal && !reduced ? { clipPath: 'inset(0 0 100% 0)', opacity: 0.4 } : false}
            animate={{ clipPath: 'inset(0 0 0% 0)', opacity: 1 }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <div className="mb-5 pr-8">
              {tags.length > 0 && (
                <p className="mb-3 font-ui text-[11px] uppercase tracking-widest text-sand/35">
                  {tags.join(' · ')}
                </p>
              )}
              <p
                className="font-display text-lg leading-relaxed"
                style={{ color: look.ink }}
                aria-label="Message content"
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="flex min-h-[36px] items-center justify-between gap-2 pt-3 border-t border-white/5">
        {confirmingReport ? (
          <>
            <p className="font-ui text-xs text-sand/60">Report and remove this bottle?</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmingReport(false)}
                className="px-3 py-1.5 rounded-xl font-ui text-xs text-sand/50 hover:text-sand/80 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReport}
                className="px-3 py-1.5 rounded-xl bg-coral/15 text-coral font-ui text-xs font-medium hover:bg-coral/25 transition-colors"
              >
                Report
              </button>
            </div>
          </>
        ) : (
          <>
            <time dateTime={bottle.sent_at} className="font-mono text-xs text-sand/30">
              {new Date(bottle.sent_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </time>

            <div className="flex items-center gap-2">
              {stage === 'open' && (
                <span className="font-ui text-xs text-sand/25 flex items-center gap-1">
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
                    className="px-3 py-1.5 rounded-xl border border-seafoam/25 text-seafoam/85 font-ui text-xs hover:bg-seafoam/10 transition-colors flex items-center gap-1"
                  >
                    <Sparkles size={13} strokeWidth={1.5} />
                    This reached me
                  </button>
                ))}

              <button
                type="button"
                onClick={() => setConfirmingReport(true)}
                disabled={isReporting}
                className="p-2 rounded-xl text-sand/25 hover:text-coral/80 transition-colors
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
    </article>
  )
}
