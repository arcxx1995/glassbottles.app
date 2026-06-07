'use client'

import { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAppDispatch, useAppSelector } from '@/store'
import { setMessage, selectMessage } from '@/store/bottleSlice'
import { cn } from '@/lib/utils'

const MAX_CHARS = 1000

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
    textareaRef.current?.focus()
  }, [])

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <motion.div
      className={cn('flex flex-col gap-3 w-full', className)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Editor surface */}
      <div className="relative rounded-2xl bg-glass border border-white/10 p-4 focus-within:border-seafoam/30 transition-colors duration-200">
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
                     placeholder:text-sand/25 resize-none outline-none min-h-[144px]"
          aria-label="Message to place in your bottle"
        />

        {/* Decorative wax seal corner */}
        <div className="absolute top-3 right-4 opacity-20 select-none pointer-events-none">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 1L13 7L7 13L1 7L7 1Z"
              stroke="#4ECDC4"
              strokeWidth="1.5"
            />
          </svg>
        </div>
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

      {/* Throw CTA — appears once text exists */}
      {canSend && onReady && (
        <motion.button
          onClick={onReady}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="w-full py-4 rounded-2xl bg-coral text-ocean-deep font-ui font-semibold
                     text-base tracking-wide transition-all duration-150
                     active:scale-[0.97] hover:brightness-110"
        >
          Seal &amp; Throw 🫙
        </motion.button>
      )}
    </motion.div>
  )
}
