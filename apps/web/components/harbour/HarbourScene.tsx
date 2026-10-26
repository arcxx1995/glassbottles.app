'use client'

import type { Route } from 'next'
import { motion, useReducedMotion } from 'motion/react'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { cn } from '@/lib/utils'
import { ringLayout, seeded, type Hull, type Kayak, type Mooring, type MyKayak, type Paddle } from '@/lib/harbour'
import KayakArt, { KayakShadow } from './KayakArt'

// The harbour from above: today's kayaks rafted in a ring over the water.
// Each kayak is its own positioned element (not one big SVG) so a tapped
// kayak can morph into its interior through a view transition.

const ASPECT = 200 / 300 // KayakArt's viewBox
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Your own kayak, when it isn't in today's twelve: moored off to one side. */
const OWN: Mooring = { x: 0.87, y: 0.88, rotate: -38, length: 0.2 }

/** Decorative ring for the preview non-Keepers see. */
const GHOSTS: { hull: Hull; paddle: Paddle }[] = [
  { hull: 'yellow', paddle: 'red' },
  { hull: 'white', paddle: 'red' },
  { hull: 'yellow', paddle: 'red' },
  { hull: 'coral', paddle: 'black' },
  { hull: 'yellow', paddle: 'red' },
  { hull: 'teal', paddle: 'white' },
  { hull: 'white', paddle: 'red' },
]

export default function HarbourScene({
  kayaks,
  mine,
  night,
  ghost = false,
}: {
  kayaks: Kayak[]
  mine: MyKayak | null
  night: boolean
  /** Preview: decorative kayaks, no names, nothing to tap. */
  ghost?: boolean
}) {
  const items = ghost
    ? GHOSTS.map((g, i) => ({ slot: i + 1, handle: '', bio: null, mine: false, ...g }))
    : kayaks
  const ring = ringLayout(items.length)
  const ownAshore = !ghost && mine?.launched && !mine.in_ring && mine.hull && mine.paddle

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className={cn('relative aspect-square', ghost && 'opacity-60 saturate-[0.85]')}
        style={{ width: 'min(100vw, calc(100svh - 9rem), 820px)' }}
      >
        {items.map((k, i) => (
          <Moored
            key={k.handle || i}
            at={ring[i]}
            seed={k.slot}
            hull={k.hull}
            paddle={k.paddle}
            night={night}
            handle={ghost ? null : k.handle}
            label={ghost ? null : k.mine ? 'you' : `@${k.handle}`}
            outward={items.length > 1}
          />
        ))}
        {ownAshore && (
          <Moored
            at={OWN}
            seed={99}
            hull={mine.hull!}
            paddle={mine.paddle!}
            night={night}
            handle={mine.handle}
            label={mine.afloat ? 'you · not in today’s ring' : 'you · ashore'}
            dim={!mine.afloat}
          />
        )}
      </div>
    </div>
  )
}

function Moored({
  at,
  seed,
  hull,
  paddle,
  night,
  handle,
  label,
  outward = false,
  dim = false,
}: {
  at: Mooring
  seed: number
  hull: Hull
  paddle: Paddle
  night: boolean
  handle: string | null
  label: string | null
  /** Label off the stern, away from the ring's centre; else below the kayak. */
  outward?: boolean
  dim?: boolean
}) {
  const reduced = useReducedMotion() ?? false
  const box = {
    left: `${at.x * 100}%`,
    top: `${at.y * 100}%`,
    width: `${at.length * ASPECT * 100}%`,
    height: `${at.length * 100}%`,
  }
  // Light falls from the top-left, so shadows drift down-right on the seabed.
  const shadow = { ...box, left: `${(at.x + at.length * 0.07) * 100}%`, top: `${(at.y + at.length * 0.1) * 100}%` }
  // One transform, centring first: the CSS `rotate` property would apply
  // before Tailwind's translate and swing every kayak off its mooring.
  const place = `translate(-50%, -50%) rotate(${at.rotate}deg)`
  const rad = (at.rotate * Math.PI) / 180
  const dir = outward ? { x: -Math.sin(rad), y: Math.cos(rad) } : { x: 0, y: 1 }
  const off = at.length / 2 + 0.05
  const bob = reduced
    ? undefined
    : {
        rotate: [0, 1.4, -1.1, 0],
        x: [0, 1.6, -1.2, 0],
        y: [0, -1.4, 1.1, 0],
      }
  const duration = 7 + seeded(seed) * 5

  const art = (
    <motion.div
      className="h-full w-full"
      animate={bob}
      transition={{ duration, repeat: Infinity, ease: 'easeInOut', delay: -seeded(seed + 7) * duration }}
    >
      <KayakArt hull={hull} paddle={paddle} lantern={night} className="h-full w-full drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]" />
    </motion.div>
  )

  return (
    <>
      <div className="pointer-events-none absolute blur-[5px]" style={{ ...shadow, transform: place }}>
        <KayakShadow className="h-full w-full" />
      </div>
      {handle ? (
        <TransitionLink
          href={`/harbour/${handle}` as Route}
          aria-label={label === 'you' || label?.startsWith('you') ? 'Your kayak' : `Kayak ${label}`}
          className={cn(
            'press absolute rounded-[40%] outline-none focus-visible:ring-2 focus-visible:ring-sand/70',
            dim && 'opacity-55 grayscale-[0.3]',
          )}
          style={{ ...box, transform: place, viewTransitionName: `kayak-${handle}` }}
        >
          {art}
        </TransitionLink>
      ) : (
        <div className="absolute" style={{ ...box, transform: place }}>
          {art}
        </div>
      )}
      {label && (
        <span
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/25 px-2 py-0.5 font-ui text-[10px] font-medium tracking-wide text-white/90 backdrop-blur-sm sm:text-[11px]"
          // Kept off the stage's edges: on a phone the stage is the screen.
          style={{ left: `${clamp(at.x + dir.x * off, 0.16, 0.84) * 100}%`, top: `${(at.y + dir.y * off) * 100}%` }}
        >
          {label}
        </span>
      )}
    </>
  )
}
