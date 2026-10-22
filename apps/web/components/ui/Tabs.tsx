'use client'

import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { spring } from './springs'

export function Tabs<T extends string>({ tabs, value, onChange, id = 'tabs', className }: {
  tabs: readonly { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  id?: string
  className?: string
}) {
  return (
    <div role="tablist" className={cn('glass inline-flex rounded-full p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn('relative rounded-full px-4 py-1.5 font-ui text-xs font-medium transition-colors',
            t.value === value ? 'text-ocean-deep' : 'text-sand/60 hover:text-sand')}
        >
          {t.value === value && (
            <motion.span layoutId={`${id}-pill`} transition={spring} className="absolute inset-0 rounded-full bg-seafoam" />
          )}
          <span className="relative">{t.label}</span>
        </button>
      ))}
    </div>
  )
}
