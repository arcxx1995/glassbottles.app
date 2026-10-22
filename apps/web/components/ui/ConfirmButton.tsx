'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { spring } from './springs'

// Two taps for anything that can't be undone: the first arms it (the label
// turns into the question, in coral), the second does it. Left alone it
// disarms after a few seconds, so a stray tap never lingers as a trap. Lighter
// than a dialog, which people learn to click through.

export default function ConfirmButton({
  onConfirm,
  confirmLabel,
  children,
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  onConfirm: () => void
  /** What the armed button says, e.g. "Delete?" */
  confirmLabel: string
  children: ReactNode
  className?: string
  disabled?: boolean
  'aria-label'?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <motion.button
      type="button"
      layout
      transition={spring}
      whileTap={{ scale: 0.95 }}
      disabled={disabled}
      aria-label={armed ? confirmLabel : ariaLabel}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onConfirm()
      }}
      onBlur={() => setArmed(false)}
      className={cn(
        // No CSS transform transition here: `layout` drives transform per frame.
        'inline-flex min-h-9 items-center gap-1 rounded-full px-2 transition-[color,background-color]',
        armed ? 'bg-coral/15 text-coral' : 'hover:text-coral',
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={armed ? 'armed' : 'idle'}
          className="inline-flex items-center gap-1"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={spring}
        >
          {armed ? confirmLabel : children}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}
