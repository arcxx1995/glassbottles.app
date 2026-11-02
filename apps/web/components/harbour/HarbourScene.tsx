'use client'

import { type Route } from 'next'
import { motion, useReducedMotion } from 'motion/react'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { MAST, atMast, bowOf, mastMooring, seeded, visitorMooring, type MyKayak, type Mooring, type Visitor } from '@/lib/harbour'
import type { KayakLook } from '@/lib/kayakLook'
import KayakArt, { KayakShadow } from './KayakArt'

// The harbour from above: a mast low in the water, your Kayaks roped to it when
// they're home, and up to 3 visitors floating free above. The same scene for
// everyone; a free member's mast just has nothing tied to it. Each Kayak is its
// own positioned element so a tapped one can morph through a view transition.

const ASPECT = 260 / 316 // drawKayak's viewBox

export default function HarbourScene({
  kayaks,
  visitors,
}: {
  kayaks: MyKayak[]
  visitors: Visitor[]
}) {
  const home = kayaks.filter(atMast)
  return (
    // Bottom-anchored square: the biggest that fits the room the page leaves it.
    <div className="flex h-full items-end justify-center [container-type:size]">
      <div className="relative aspect-square shrink-0" style={{ width: 'min(100cqw, 100cqh, 820px)' }}>
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {home.map((k, i) => {
            const bow = bowOf(mastMooring(i))
            return (
              <path
                key={k.id}
                d={`M${MAST.x * 100} ${MAST.y * 100}Q${((MAST.x + bow.x) / 2) * 100} ${((MAST.y + bow.y) / 2) * 100 + 3} ${bow.x * 100} ${bow.y * 100}`}
                fill="none"
                stroke="#E8D9B5"
                strokeWidth=".5"
                strokeDasharray="1 .3"
              />
            )
          })}
        </svg>
        <Mast tied={home.length > 0} />

        {home.map((k, i) => (
          <Moored
            key={k.id}
            at={mastMooring(i)}
            seed={i + 1}
            look={k.look}
            aboard={k.aboard}
            href={`/harbour/kayak/${k.id}`}
            ariaLabel={`Your Kayak ${i + 1}`}
            name={`kayak-${k.id}`}
            badge={k.new_comments}
          />
        ))}
        {visitors.map((v, i) => (
          <Moored
            key={v.visit_id}
            at={visitorMooring(i)}
            seed={i + 11}
            look={v.look}
            aboard={v.aboard}
            href={`/harbour/visit/${v.visit_id}`}
            ariaLabel="A visiting Kayak"
            name={`visit-${v.visit_id}`}
            label="A visitor"
          />
        ))}
      </div>
    </div>
  )
}

/** Like a shortcut on a desktop: on the screen's right edge, not in the water. */
export function TreasureIcon({ count }: { count: number }) {
  return (
    <TransitionLink
      href={'/harbour/treasure' as Route}
      aria-label={count > 0 ? `Your treasure room, ${count} ${count === 1 ? 'item' : 'items'}` : 'Your treasure room'}
      className="press absolute right-2 top-16 z-10 flex w-[4.5rem] flex-col items-center rounded-2xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-sand/70 sm:right-5"
    >
      <span className="relative">
        <Chest />
        {count > 0 && (
          <span className="absolute -right-2 -top-1.5 min-w-[1.125rem] rounded-full bg-seafoam px-1 text-center font-ui text-[10px] font-semibold leading-[1.125rem] text-ocean-deep">
            {count}
          </span>
        )}
      </span>
      <span className="mt-1 font-ui text-[11px] font-medium text-white [text-shadow:0_1px_3px_rgba(0,20,30,0.8)]">Treasure</span>
    </TransitionLink>
  )
}

function Mast({ tied }: { tied: boolean }) {
  return (
    <div
      data-testid="mast"
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${MAST.x * 100}%`, top: `${MAST.y * 100}%`, width: '13%' }}
    >
      {/* Seen from straight above: a weathered post, a ring of rope, and a ripple where it meets the water. */}
      <svg viewBox="0 0 60 60" className="block w-full drop-shadow-[3px_5px_4px_rgba(0,30,50,0.45)]" aria-hidden="true">
        <circle cx="30" cy="30" r="27" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="1.5" />
        <circle cx="30" cy="30" r="20" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="1" />
        <circle cx="30" cy="30" r="13.5" fill="#6d5233" />
        <circle cx="30" cy="30" r="13.5" fill="none" stroke="#3f2d17" strokeWidth="1.4" />
        <circle cx="30" cy="30" r="9" fill="none" stroke="#574126" strokeWidth=".8" />
        <circle cx="30" cy="30" r="5" fill="none" stroke="#574126" strokeWidth=".8" />
        <circle cx="26" cy="26" r="1.6" fill="#a58a60" />
        <circle cx="30" cy="30" r="15.5" fill="none" stroke="#E8D9B5" strokeWidth="2.6" strokeDasharray="2.4 .6" strokeOpacity={tied ? 1 : 0.65} />
      </svg>
    </div>
  )
}

function Chest() {
  return (
    <svg viewBox="0 0 44 36" className="h-9 w-11 drop-shadow-[2px_4px_3px_rgba(0,30,50,0.45)]" aria-hidden="true">
      <rect x="3" y="4" width="38" height="28" rx="3" fill="#7c5730" />
      <rect x="3" y="4" width="38" height="28" rx="3" fill="none" stroke="#472f16" strokeWidth="1.4" />
      <path d="M3 14H41M15 4V32M29 4V32" stroke="#472f16" strokeWidth="1" />
      <path d="M3 8H41M3 28H41" stroke="#c9a15b" strokeWidth="2" />
      <rect x="18.5" y="11" width="7" height="8" rx="1.4" fill="#e3bb6c" stroke="#7b5a1f" />
    </svg>
  )
}

function Moored({
  at,
  seed,
  look,
  aboard,
  href,
  ariaLabel,
  name,
  label,
  badge = 0,
}: {
  at: Mooring
  seed: number
  look: KayakLook
  aboard: number
  href: string
  ariaLabel: string
  name: string
  label?: string
  badge?: number
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
  // before Tailwind's translate and swing every Kayak off its mooring.
  const place = `translate(-50%, -50%) rotate(${at.rotate}deg)`
  const bob = reduced ? undefined : { rotate: [0, 1.4, -1.1, 0], x: [0, 1.6, -1.2, 0], y: [0, -1.4, 1.1, 0] }
  const duration = 7 + seeded(seed) * 5
  // How far the Kayak reaches below its centre at this angle, for the label.
  const rad = (at.rotate * Math.PI) / 180
  const reach = at.length * (0.46 * Math.abs(Math.cos(rad)) + 0.2 * Math.abs(Math.sin(rad)))

  return (
    <>
      <div className="pointer-events-none absolute blur-[5px]" style={{ ...shadow, transform: place }}>
        <KayakShadow look={look} className="h-full w-full" />
      </div>
      <TransitionLink
        href={href as Route}
        aria-label={ariaLabel}
        className="press absolute rounded-[40%] outline-none focus-visible:ring-2 focus-visible:ring-sand/70"
        style={{ ...box, transform: place, viewTransitionName: name }}
      >
        <motion.div
          className="h-full w-full"
          animate={bob}
          transition={{ duration, repeat: Infinity, ease: 'easeInOut', delay: -seeded(seed + 7) * duration }}
        >
          <KayakArt look={look} aboard={aboard} className="h-full w-full" />
        </motion.div>
      </TransitionLink>
      {badge > 0 && (
        <span
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-seafoam px-1.5 py-0.5 font-ui text-[10px] font-semibold text-ocean-deep"
          style={{ left: `${(at.x + 0.06) * 100}%`, top: `${(at.y - 0.09) * 100}%` }}
        >
          {badge}
        </span>
      )}
      {label && (
        <span
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/25 px-2 py-0.5 font-ui text-[10px] font-medium tracking-wide text-white/90 backdrop-blur-sm sm:text-[11px]"
          style={{ left: `${at.x * 100}%`, top: `${Math.min(at.y + reach + 0.015, 0.97) * 100}%` }}
        >
          {label}
        </span>
      )}
    </>
  )
}
