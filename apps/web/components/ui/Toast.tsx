'use client'

import { useRef, useState, type ComponentProps } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { cn } from '@/lib/utils'
import { project, spring, springSheet } from './springs'

// A banner that slides in from the right and leaves the way it came: swipe it
// back out to dismiss. It follows the finger 1:1, fades as it goes, and a
// flick is projected forward. Short of half its width it springs home.
// Render as a direct child of <AnimatePresence> with a key.

export default function Toast({
  onDismiss,
  className,
  children,
  ...props
}: { onDismiss: () => void } & Omit<
  ComponentProps<typeof motion.div>,
  'drag' | 'style' | 'initial' | 'animate' | 'exit' | 'transition'
>) {
  const x = useMotionValue(0)
  // Opacity is a function of position, so entering, swiping and leaving all
  // fade the same way.
  const fade = useTransform(x, [0, 160], [1, 0])
  const [flungTo, setFlungTo] = useState<number | null>(null)
  // Reduced motion: no slide (transforms are off), so fade on its own.
  const reduced = useReducedMotion() ?? false
  const dragged = useRef(false)

  return (
    <motion.div
      {...props}
      style={reduced ? { x } : { x, opacity: fade }}
      initial={reduced ? { opacity: 0 } : { x: 80, scale: 0.95 }}
      animate={reduced ? { opacity: 1 } : { x: 0, scale: 1 }}
      // A flung toast keeps travelling (exit spring inherits x's velocity);
      // a tapped-away one slips back out to the right.
      exit={reduced ? { opacity: 0 } : flungTo !== null ? { x: flungTo } : { x: 160, scale: 0.95 }}
      transition={spring}
      drag="x"
      dragConstraints={{ left: 0 }}
      dragElastic={{ left: 0.08, right: 1 }}
      dragMomentum={false}
      onDragStart={() => (dragged.current = true)}
      onDragEnd={(e, info) => {
        const w = (e.target as HTMLElement).closest('[data-toast]')?.clientWidth ?? 320
        if (x.get() + project(info.velocity.x) > w * 0.5 && info.velocity.x > -200) {
          setFlungTo(w + 40)
          onDismiss()
        } else {
          animate(x, 0, { ...springSheet, velocity: info.velocity.x })
        }
        // The pointerup after a drag still clicks whatever was under it.
        setTimeout(() => (dragged.current = false))
      }}
      onClickCapture={(e) => {
        if (dragged.current) {
          e.stopPropagation()
          e.preventDefault()
        }
      }}
      data-toast=""
      className={cn('cursor-grab active:cursor-grabbing', className)}
    >
      {children}
    </motion.div>
  )
}
