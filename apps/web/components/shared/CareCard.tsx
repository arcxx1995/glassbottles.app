'use client'

import { motion } from 'motion/react'
import { spring } from '@/components/ui/springs'
import { X } from 'lucide-react'
import { helpLinesFor } from '@/lib/care'

// Shown to a sender whose bottle reads like they may be in danger (043). The
// bottle still sails — nothing is blocked — and this stays gentle: no alarm,
// no lecture, just a hand held out.

export default function CareCard({
  timezone,
  onClose,
}: {
  timezone: string | null | undefined
  onClose: () => void
}) {
  const lines = helpLinesFor(timezone)
  return (
    <motion.div
      role="complementary"
      aria-label="Support"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className="relative w-full max-w-[380px] rounded-3xl glass-strong border-seafoam/25 p-4 text-left"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="press absolute right-2 top-2 p-2 rounded-xl text-sand/35 hover:text-sand/70 transition-[color,transform]"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
      <p className="font-display text-base text-sand pr-6">Your bottle is on its way.</p>
      <p className="font-ui text-xs text-sand/60 leading-relaxed mt-1">
        If you&rsquo;re carrying something heavy right now, you don&rsquo;t have to carry it
        alone. Someone is there to listen, any hour.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l.name}>
            <a
              href={l.href}
              target={l.href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="press flex flex-col rounded-xl border border-white/10 px-3 py-2 hover:border-seafoam/30 transition-[border-color,transform]"
            >
              <span className="font-ui text-sm text-sand/85">{l.name}</span>
              <span className="font-ui text-[11px] text-sand/45 mt-0.5">{l.detail}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="font-ui text-[10px] text-sand/45 leading-snug mt-2">
        In immediate danger? Call your local emergency number.
      </p>
    </motion.div>
  )
}
