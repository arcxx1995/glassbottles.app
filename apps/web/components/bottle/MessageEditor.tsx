'use client'

import { useRef, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useAppDispatch, useAppSelector } from '@/store'
import { setMessage, selectMessage } from '@/store/bottleSlice'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import CrisisSupport from './CrisisSupport'

const MAX_CHARS = 1000
const MAX_TEXTAREA_HEIGHT = 168
const CHECK_DEBOUNCE_MS = 800

/** Why a bottle can't be thrown, by screen reason (check-message / 051). */
export const HELD_COPY: Record<string, string> = {
  blocked: 'It contains language that isn’t allowed here.',
  sexual: 'Sexual content isn’t allowed here.',
  minor: 'Sexual content isn’t allowed here.',
  contact: 'Bottles stay anonymous: no contact details, handles or links.',
  harm: 'It reads as hurtful or threatening toward someone.',
  spam: 'It looks like advertising or spam.',
  review: 'It needs a closer look before it can sail.',
  account_suspended: 'Your account is suspended for breaking our guidelines.',
  age_unconfirmed: 'Please confirm you’re 18 or older first.',
}

type CheckResult = { verdict: 'ok' | 'held' | 'crisis' | 'unknown'; reason?: string }

// Verdicts by draft text, so a pause and the throw don't ask twice.
const checked = new Map<string, CheckResult>()

/** The live filter: the safety screen's verdict on a draft (check-message,
 *  migration 052). Fail-closed: only 'ok' throws; 'unknown' (screen
 *  unreachable) is never cached, so the next tap asks again. */
async function checkMessage(text: string): Promise<CheckResult> {
  const hit = checked.get(text)
  if (hit) return hit
  const { data, error } = await createClient().functions.invoke<CheckResult>('check-message', {
    body: { text },
  })
  if (error || !data?.verdict) return { verdict: 'unknown' }
  if (data.verdict !== 'unknown') checked.set(text, data)
  return data
}

interface MessageEditorProps {
  onReady?: () => void
  className?: string
}

export default function MessageEditor({
  onReady,
  className,
}: MessageEditorProps) {
  const dispatch = useAppDispatch()
  const message = useAppSelector(selectMessage)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Latest verdict; a hold stays up until a re-check of the edited text clears it.
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [gating, setGating] = useState(false)

  const remaining = MAX_CHARS - message.length
  const isNearLimit = remaining <= 100
  const isOverLimit = remaining < 0
  const draft = message.trim()
  const blocked = draft.length > 0 && (check?.verdict === 'held' || check?.verdict === 'crisis')
  const canSend = draft.length > 0 && !isOverLimit && !blocked

  // Check while typing: once the writer pauses.
  useEffect(() => {
    if (!draft || draft.length > MAX_CHARS) return
    let stale = false
    const t = setTimeout(async () => {
      const result = await checkMessage(draft)
      if (!stale) setCheck(result)
    }, CHECK_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [draft])

  // And once more on the throw itself (cached if the pause already asked),
  // so a quick tap can't beat the debounce.
  async function handleThrow() {
    if (gating || !onReady) return
    setGating(true)
    const result = await checkMessage(draft)
    setGating(false)
    setCheck(result)
    if (result.verdict === 'ok') onReady()
  }

  useEffect(() => {
    // Auto-focus only on devices with a fine pointer (desktop). On touch this
    // would pop the keyboard the instant you land on the throw screen, hiding
    // the bottle scene and the "Seal & Throw" CTA — let mobile users tap to type.
    if (window.matchMedia?.('(pointer: fine)').matches) {
      textareaRef.current?.focus()
    }
  }, [])

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    const nextHeight = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'
  }

  return (
    <motion.div
      className={cn('flex flex-col gap-3 w-full', className)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Editor surface */}
      <div className="relative rounded-2xl bg-glass border border-white/10 p-4 focus-within:border-white/20 transition-colors duration-200">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            dispatch(setMessage(e.target.value))
            autoResize(e.target)
          }}
          onFocus={(e) => autoResize(e.target)}
          placeholder="Write something for a stranger to find…"
          rows={6}
          className="w-full bg-transparent font-display text-sand text-lg leading-relaxed
                     placeholder:text-sand/25 resize-none outline-none focus-visible:outline-none
                     min-h-[104px] sm:min-h-[132px] max-h-[168px] overflow-y-hidden"
          aria-label="Message to place in your bottle"
        />
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between px-1">
        <span className="font-ui text-xs text-sand/30">
          Anonymous. Be kind. Be honest.
        </span>
        <span
          className={cn(
            'font-mono text-xs tabular-nums transition-colors duration-150',
            isOverLimit
              ? 'text-coral'
              : isNearLimit
              ? 'text-sand/50'
              : 'text-sand/25'
          )}
        >
          {remaining}
        </span>
      </div>

      {/* The live filter's answer: why this can't be thrown, or, for someone
          who may be in danger, people to talk to instead. */}
      {blocked && check?.verdict === 'held' && (
        <p role="alert" className="px-1 font-ui text-xs text-coral leading-relaxed">
          This can&rsquo;t be thrown. {HELD_COPY[check.reason ?? ''] ?? HELD_COPY.review}{' '}
          {check.reason === 'account_suspended' || check.reason === 'age_unconfirmed'
            ? 'See our '
            : 'Edit it to continue — '}
          <a href="/guidelines" target="_blank" className="underline">
            community guidelines
          </a>
          .
        </p>
      )}
      {draft.length > 0 && check?.verdict === 'unknown' && (
        <p role="alert" className="px-1 font-ui text-xs text-sand/60 leading-relaxed">
          We couldn&rsquo;t check your bottle just now. Give it a moment and tap Seal &amp; Throw
          to try again.
        </p>
      )}
      {blocked && check?.verdict === 'crisis' && (
        <CrisisSupport lead="This bottle won’t be sent to a stranger." />
      )}

      {/* Throw CTA — appears once text exists. Height animates so the layout
          eases open/closed instead of jumping when the button (un)mounts. */}
      <AnimatePresence initial={false}>
        {canSend && onReady && (
          <motion.div
            key="throw-cta"
            initial={{ opacity: 0, y: 6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 6, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <motion.button
              onClick={handleThrow}
              disabled={gating}
              whileTap={{ scale: 0.97 }}
              className="w-full py-4 rounded-2xl bg-seafoam text-ocean-deep font-ui font-semibold
                         text-base tracking-wide transition-all duration-150
                         hover:brightness-110 disabled:opacity-70"
            >
              {gating ? 'Checking…' : <>Seal &amp; Throw</>}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
