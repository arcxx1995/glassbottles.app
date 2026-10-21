'use client'

import { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Cloud, CloudFog, CloudLightning, Hourglass, Sparkles, Sun } from 'lucide-react'
import { useStore } from 'react-redux'
import { useAppDispatch, useAppSelector, type RootState } from '@/store'
import {
  setMessage,
  selectMessage,
  setStyle,
  setWeather,
  setVibe,
  selectDraftStyle,
  selectDraftWeather,
  selectDraftVibe,
} from '@/store/bottleSlice'
import { useGetAtelierQuery, useGetCoinsQuery, useGetKeeperQuery } from '@/store/api/bottleApi'
import { cn } from '@/lib/utils'
import {
  VIBES,
  VIBE_LABEL,
  WEATHERS,
  WEATHER_LABEL,
  allowedStyle,
  loadStyle,
  resolveLook,
  saveStyle,
  stashDraft,
  takeDraft,
  type Weather,
} from '@/lib/dressing'
import { BottleSVG } from './ThrowAnimation'
import AtelierSheet from './AtelierSheet'
import FutureSheet from './FutureSheet'
import { createClient } from '@/lib/supabase/client'
import { nextSpark } from '@/lib/sparks'
import { selectUser } from '@/store/authSlice'

const WEATHER_ICON: Record<Weather, typeof Sun> = {
  stormy: CloudLightning,
  foggy: CloudFog,
  calm: Cloud,
  sunny: Sun,
}

const MAX_CHARS = 1000
const MAX_TEXTAREA_HEIGHT = 168

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

  const spark = useSpark()

  const remaining = MAX_CHARS - message.length
  const isNearLimit = remaining <= 100
  const isOverLimit = remaining < 0
  const canSend = message.trim().length > 0 && !isOverLimit

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
          placeholder={spark.question ?? 'Write something for a stranger to find…'}
          rows={6}
          className="w-full bg-transparent font-display text-sand text-lg leading-relaxed
                     placeholder:text-sand/25 resize-none outline-none focus-visible:outline-none
                     min-h-[104px] sm:min-h-[132px] max-h-[168px] overflow-y-hidden"
          aria-label="Message to place in your bottle"
        />
        {/* Spark (046): a question to start from, shown as the empty box's
            placeholder — never written into the bottle. */}
        {message.length === 0 && (
          <button
            type="button"
            onClick={() => void spark.next()}
            disabled={spark.loading}
            aria-label={spark.question ? 'Another spark' : 'Need a spark?'}
            title={spark.note ?? (spark.question ? 'Another spark' : 'Need a spark?')}
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-xl px-2 py-1.5 font-ui text-[11px] text-sand/35 hover:text-seafoam transition-colors disabled:opacity-40"
          >
            <Sparkles size={13} strokeWidth={1.5} className={spark.loading ? 'animate-pulse' : undefined} />
            {spark.question ? 'Another' : 'Need a spark?'}
          </button>
        )}
      </div>

      <DressingRow />

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
              onClick={onReady}
              whileTap={{ scale: 0.97 }}
              className="w-full py-4 rounded-2xl bg-seafoam text-ocean-deep font-ui font-semibold
                         text-base tracking-wide transition-all duration-150
                         hover:brightness-110"
            >
              Seal &amp; Throw
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Dressing row ─────────────────────────────────────────────────────────────
// One quiet scrollable line under the note: the sky it was thrown under, a
// vibe label, and the Atelier. All optional; a bare bottle is still a bottle.

function DressingRow() {
  const dispatch = useAppDispatch()
  const store = useStore<RootState>()
  const style = useAppSelector(selectDraftStyle)
  const weather = useAppSelector(selectDraftWeather)
  const vibe = useAppSelector(selectDraftVibe)
  const { data: pieces } = useGetAtelierQuery()
  const keeperOn = process.env.NEXT_PUBLIC_KEEPER === 'on'
  const { data: keeper, isError: keeperFailed } = useGetKeeperQuery(undefined, { skip: !keeperOn })
  const isKeeper = !!keeper?.isKeeper
  const unlocked = useGetCoinsQuery().data?.unlocked ?? []
  // The Atelier needs to know who's a Keeper before it can lock anything.
  const ready = !!pieces && (!keeperOn || keeper !== undefined || keeperFailed)
  const [open, setOpen] = useState(false)
  const [futureOpen, setFutureOpen] = useState(false)
  const [sealedFor, setSealedFor] = useState<string | null>(null)
  useEffect(() => {
    if (!sealedFor) return
    const t = setTimeout(() => setSealedFor(null), 5000)
    return () => clearTimeout(t)
  }, [sealedFor])

  // Once per mount: the remembered dressing, and a draft that went to
  // checkout and came back.
  useEffect(() => {
    const state = store.getState().bottle
    if (Object.keys(state.style).length === 0) dispatch(setStyle(loadStyle()))
    const draft = takeDraft()
    if (draft && !state.message) dispatch(setMessage(draft))
  }, [dispatch, store])

  // What will actually be thrown — a remembered Keeper piece after a lapse
  // falls back to the free look.
  const look = resolveLook(allowedStyle(style, pieces, isKeeper || !ready, unlocked), pieces)

  const chip = (on: boolean) =>
    cn(
      'shrink-0 h-8 rounded-full border px-3 font-ui text-xs transition-colors whitespace-nowrap',
      on ? 'border-seafoam/50 bg-seafoam/10 text-sand/90' : 'border-white/10 text-sand/45 hover:text-sand/70',
    )

  return (
    <>
      {/* Dress leads: on phones the row scrolls, and the Atelier must never be
          the part scrolled out of sight. Wraps instead on wider screens. */}
      <div
        className="no-scrollbar flex items-center gap-1.5 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible"
        role="group"
        aria-label="Dress your bottle"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!ready}
          className={cn(chip(false), 'flex items-center gap-1.5 disabled:opacity-40')}
        >
          <BottleSVG width={12} height={18} look={look} />
          Dress
        </button>
        {keeperOn && (
          <button
            type="button"
            onClick={() => setFutureOpen(true)}
            disabled={!ready}
            className={cn(chip(false), 'flex items-center gap-1.5 disabled:opacity-40')}
          >
            <Hourglass size={13} strokeWidth={1.5} />
            Future me
          </button>
        )}
        <span className="mx-1 h-4 w-px shrink-0 bg-white/10" aria-hidden />
        {WEATHERS.map((w) => {
          const Icon = WEATHER_ICON[w]
          return (
            <button
              key={w}
              type="button"
              aria-pressed={weather === w}
              aria-label={`${WEATHER_LABEL[w]} sky`}
              title={`${WEATHER_LABEL[w]} sky`}
              onClick={() => dispatch(setWeather(weather === w ? null : w))}
              className={cn(chip(weather === w), 'w-8 px-0 flex items-center justify-center')}
            >
              <Icon size={14} strokeWidth={1.5} />
            </button>
          )
        })}
        <span className="mx-1 h-4 w-px shrink-0 bg-white/10" aria-hidden />
        {VIBES.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={vibe === v}
            onClick={() => dispatch(setVibe(vibe === v ? null : v))}
            className={chip(vibe === v)}
          >
            {VIBE_LABEL[v]}
          </button>
        ))}
      </div>

      {sealedFor && (
        <p role="status" className="px-1 font-ui text-xs text-seafoam/90">
          Sealed. It washes back to you on{' '}
          {new Date(sealedFor + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
        </p>
      )}

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {futureOpen && ready && (
              <FutureSheet
                message={store.getState().bottle.message}
                style={allowedStyle(style, pieces, isKeeper, unlocked)}
                weather={weather}
                isKeeper={isKeeper}
                onSent={(deliverOn) => {
                  dispatch(setMessage(''))
                  dispatch(setWeather(null))
                  dispatch(setVibe(null))
                  setSealedFor(deliverOn)
                }}
                onClose={() => setFutureOpen(false)}
                onBeforeCheckout={() => stashDraft(store.getState().bottle.message)}
              />
            )}
            {open && ready && pieces && (
              <AtelierSheet
                pieces={pieces}
                style={style}
                isKeeper={isKeeper}
                onSave={(next) => {
                  dispatch(setStyle(next))
                  saveStyle(next)
                }}
                onClose={() => setOpen(false)}
                onBeforeCheckout={() => stashDraft(store.getState().bottle.message)}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}

// ─── Spark ────────────────────────────────────────────────────────────────────
// Keepers ask the spark function (Claude, five a day, tuned to the chosen sky
// and current); everyone else — and any failure or used-up day — draws from
// the static deck.

function useSpark() {
  const store = useStore<RootState>()
  const keeperOn = process.env.NEXT_PUBLIC_KEEPER === 'on'
  const { data: keeper } = useGetKeeperQuery(undefined, { skip: !keeperOn })
  const [question, setQuestion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [aiDone, setAiDone] = useState(false)

  async function next() {
    if (!keeper?.isKeeper || aiDone) {
      setQuestion((q) => nextSpark(q))
      return
    }
    setLoading(true)
    const { weather, vibe } = store.getState().bottle
    const current = selectUser(store.getState())?.current ?? undefined
    const { data, error } = await createClient()
      .functions.invoke('spark', { body: { weather, vibe, current } })
      .catch(() => ({ data: null, error: true }))
    setLoading(false)
    const q = (data as { question?: string | null; left?: number } | null)?.question
    const left = (data as { left?: number } | null)?.left
    if (q) {
      setQuestion(q)
      setNote(typeof left === 'number' ? `${left} AI spark${left === 1 ? '' : 's'} left today` : null)
      if (left === 0) setAiDone(true)
    } else {
      // Used up (429), not configured, or the call failed: the deck answers.
      if (error) setAiDone(true)
      setNote('From the spark deck')
      setQuestion((cur) => nextSpark(cur))
    }
  }

  return { question, loading, note, next }
}
