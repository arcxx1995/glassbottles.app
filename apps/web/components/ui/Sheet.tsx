'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useDragControls, useMotionValue, useTransform } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { feel } from '@/lib/feel'
import { project, spring, springSheet } from './springs'

// Bottom sheet on phones, centred dialog from `sm` up. Render it as the direct
// child of <AnimatePresence> so it can exit.
//
// Phone: grab the handle/header and the sheet follows the finger 1:1, the
// scrim thins as it goes, and the top edge rubber-bands. On release the
// flick's momentum is projected forward: if it would come to rest past half
// the sheet, it dismisses, carrying the finger's velocity down the same path
// it came up. Otherwise it springs home. Grabbing it mid-close isn't
// possible (it unmounts), but grabbing it mid-open is: the drag takes over
// from the live position.

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function Sheet({
  title,
  onClose,
  children,
  className,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const controls = useDragControls()
  const [phone] = useState(() => !window.matchMedia('(min-width: 640px)').matches)
  const [vh] = useState(() => window.innerHeight)
  const y = useMotionValue(phone ? vh : 0)
  const scrim = useTransform(y, [0, vh * 0.6], [1, 0])

  // Focus in, trap Tab, Escape closes, body can't scroll; focus goes back to
  // whatever opened the sheet.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <motion.div
        className="absolute inset-0 bg-ocean-deep/50"
        // Phone: the dim tracks the sheet's position (drag thins it).
        style={phone ? { opacity: scrim } : undefined}
        // Materialize: the blur thickens with the dim instead of a flat fade.
        initial={phone ? { backdropFilter: 'blur(0px)' } : { backdropFilter: 'blur(0px)', opacity: 0 }}
        animate={phone ? { backdropFilter: 'blur(12px)' } : { backdropFilter: 'blur(12px)', opacity: 1 }}
        exit={phone ? { backdropFilter: 'blur(0px)' } : { backdropFilter: 'blur(0px)', opacity: 0 }}
        transition={spring}
        onClick={onClose}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'relative flex w-full max-w-md max-h-[88dvh] flex-col overflow-hidden',
          'rounded-t-[1.75rem] sm:rounded-3xl glass-strong shadow-2xl',
        )}
        style={phone ? { y } : undefined}
        // Opacity rides along so reduced motion (transforms off) still cross-fades.
        initial={phone ? { y: vh, opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
        animate={phone ? { y: 0, opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={phone ? { y: vh, opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
        transition={phone ? springSheet : spring}
        drag={phone ? 'y' : false}
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0.08, bottom: 1 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          const h = panelRef.current?.offsetHeight ?? vh
          const v = info.velocity.y
          if (y.get() + project(v) > h * 0.5 && v > -300) {
            feel('tick')
            onClose() // exit spring picks up y's live velocity
          } else {
            animate(y, 0, { ...springSheet, velocity: v })
          }
        }}
      >
        {/* Grab zone: handle + header. Content below scrolls on its own. */}
        <div
          className="shrink-0 px-5 pt-2 pb-2 sm:pt-5 touch-none sm:touch-auto cursor-grab active:cursor-grabbing sm:cursor-auto"
          onPointerDown={(e) => {
            if (phone && !(e.target as HTMLElement).closest('button')) controls.start(e)
          }}
        >
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-sand/25 sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between">
            <h2 className="font-display text-headline text-sand">{title}</h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press -mr-3 flex h-11 w-11 items-center justify-center rounded-full text-sand/50 hover:text-sand/85 hover:bg-white/5 transition-[color,background-color,border-color,transform]"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar',
            'px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
            className,
          )}
        >
          {children}
        </div>
      </motion.div>
    </div>
  )
}
