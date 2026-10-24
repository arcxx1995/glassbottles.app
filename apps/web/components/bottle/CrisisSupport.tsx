'use client'

import { motion } from 'motion/react'

// Shown when the safety screen reads a draft (or a thrown bottle) as someone
// who may be in danger (migration 052). Such a bottle is never delivered;
// the writer gets people to talk to instead — the promise on /guidelines.
const LINES = [
  { where: 'US', label: '988', href: 'tel:988' },
  { where: 'UK & IE', label: '116 123', href: 'tel:116123' },
  { where: 'India', label: '14416', href: 'tel:14416' },
  { where: 'Elsewhere', label: 'findahelpline.com', href: 'https://findahelpline.com' },
]

export default function CrisisSupport({ lead, onDismiss }: { lead: string; onDismiss?: () => void }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rounded-2xl border border-seafoam/25 bg-seafoam/10 px-4 py-3 text-left"
    >
      <p className="font-ui text-xs text-sand/80 leading-relaxed">
        <span className="text-sand">You don&rsquo;t have to carry this alone.</span> {lead} Free help,
        any time:
      </p>
      <p className="mt-1 font-ui text-xs leading-relaxed text-sand/55">
        {LINES.map((l, i) => (
          <span key={l.where}>
            {i > 0 && ' · '}
            <span className="whitespace-nowrap">
              {l.where}{' '}
              <a
                href={l.href}
                target={l.href.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
                className="text-seafoam underline underline-offset-2"
              >
                {l.label}
              </a>
            </span>
          </span>
        ))}
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 font-ui text-xs text-sand/55 underline underline-offset-2"
        >
          Okay
        </button>
      )}
    </motion.div>
  )
}
