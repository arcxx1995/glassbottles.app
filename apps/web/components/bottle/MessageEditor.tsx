'use client'

import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useAppDispatch, useAppSelector } from '@/store'
import { setMessage, selectMessage } from '@/store/bottleSlice'
import { cn } from '@/lib/utils'

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
