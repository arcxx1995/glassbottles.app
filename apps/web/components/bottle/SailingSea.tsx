'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { BottleSVG } from './ThrowAnimation'

export interface SailingBottleItem {
  id: string
  day_key: string
}

/** "2026-06-10" → "Jun 10". Falls back to the raw key if unparseable. */
function formatDay(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dayKey
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── FloatingBottle ──────────────────────────────────────────────────────────
// A single bottle bobbing in the sea, with its throw-date pill hovering above.
// Phase/drift are derived from index so each bottle moves out of sync — reads
// as a scattered, living ocean rather than a synchronized row.

function FloatingBottle({
  item,
  index,
}: {
  item: SailingBottleItem
  index: number
}) {
  const delay = (index % 5) * 0.4
  const drift = index % 2 === 0 ? 1 : -1
  const bobDuration = 3 + (index % 3) * 0.5

  return (
    <motion.div
      layout
      className="flex flex-col items-center gap-2"
      initial={{ opacity: 0, y: 24, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{
        opacity: 0,
        y: -34,
        scale: 0.5,
        transition: { duration: 0.65, ease: 'easeIn' },
      }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Date pill hovering above the bottle */}
      <span
        className="font-mono text-[10px] text-seafoam/70 bg-seafoam/10
                   border border-seafoam/15 px-2 py-0.5 rounded-full whitespace-nowrap"
      >
        {formatDay(item.day_key)}
      </span>

      {/* Bobbing bottle */}
      <motion.div
        animate={{
          y: [0, -8, 0],
          rotate: [-2 * drift, 2 * drift, -2 * drift],
        }}
        transition={{
          duration: bobDuration,
          repeat: Infinity,
          ease: 'easeInOut',
          delay,
        }}
      >
        <BottleSVG glowing width={52} height={78} />
      </motion.div>
    </motion.div>
  )
}

// ─── SailingSea ──────────────────────────────────────────────────────────────
// Lays out every undelivered bottle. When one is matched it drops out of the
// `bottles` array and AnimatePresence floats it away; popLayout reflows the rest.

export default function SailingSea({
  bottles,
}: {
  bottles: SailingBottleItem[]
}) {
  return (
    <div
      className="flex flex-wrap items-end justify-center gap-x-7 gap-y-7 max-w-sm mx-auto"
      aria-label={`${bottles.length} bottles still sailing`}
    >
      <AnimatePresence mode="popLayout">
        {bottles.map((b, i) => (
          <FloatingBottle key={b.id} item={b} index={i} />
        ))}
      </AnimatePresence>
    </div>
  )
}
