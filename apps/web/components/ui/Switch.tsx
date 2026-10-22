'use client'

import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue } from 'motion/react'
import { cn } from '@/lib/utils'
import { project, rubberband, spring } from './springs'

const TRAVEL = 20

// iOS-style switch. Tap flips it; or drag the thumb across: it tracks the
// finger 1:1, resists past either end, and on release the flick's momentum
// decides the side, so a quick swipe commits even from a short drag. Pressed,
// the thumb stretches toward where it's going. The hit area is taller than
// the track (44px) without changing the layout.

export default function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  const x = useMotionValue(checked ? TRAVEL : 0)
  const from = useRef(0)
  const panned = useRef(false)

  useEffect(() => {
    const c = animate(x, checked ? TRAVEL : 0, spring)
    return () => c.stop()
  }, [checked, x])

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      style={{ touchAction: 'pan-y' }}
      onPanStart={() => {
        panned.current = true
        from.current = x.get()
      }}
      onPan={(_, info) => {
        const raw = from.current + info.offset.x
        x.set(raw < 0 ? rubberband(raw, TRAVEL) : raw > TRAVEL ? TRAVEL + rubberband(raw - TRAVEL, TRAVEL) : raw)
      }}
      onPanEnd={(_, info) => {
        const next = x.get() + project(info.velocity.x, 0.99) > TRAVEL / 2
        if (next !== checked) onChange(next)
        else animate(x, checked ? TRAVEL : 0, { ...spring, velocity: info.velocity.x })
        // The pointerup that ends a pan still fires a click.
        setTimeout(() => (panned.current = false))
      }}
      onClick={() => {
        if (!panned.current) onChange(!checked)
      }}
      className={cn(
        'group relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
        'before:absolute before:-inset-y-2.5 before:-inset-x-1 before:content-[""]',
        checked ? 'bg-seafoam/80' : 'bg-white/10',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <motion.span
        style={{ x }}
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-sand shadow-[0_2px_6px_rgba(0,0,0,0.3)] transition-[width,margin] duration-150 group-active:w-6',
          checked && 'group-active:-ml-1',
        )}
      />
    </motion.button>
  )
}
