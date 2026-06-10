'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion, useInView, type Variants } from 'framer-motion'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useAppSelector } from '@/store'
import { selectUser, selectIsLoading } from '@/store/authSlice'
import WaveBackground from '@/components/shared/WaveBackground'

const BottleCanvas = dynamic(
  () => import('@/components/bottle/BottleCanvas'),
  { ssr: false }
)

// ── Constants ─────────────────────────────────────────────────────────────
const EASE_OUT_QUART = [0.25, 1, 0.5, 1] as const
const OCEAN_COUNT = 4821

// ── Count-up on inView ────────────────────────────────────────────────────
function useCountUp(target: number, active: boolean, reduced: boolean, duration = 2000) {
  const [value, setValue] = useState(reduced ? target : 0)
  const hasRun = useRef(false)

  useEffect(() => {
    if (reduced) {
      setValue(target)
      return
    }
    if (!active || hasRun.current) return
    hasRun.current = true
    const start = Date.now()
    function tick() {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 4)
      setValue(Math.round(eased * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [active, target, duration, reduced])

  return value
}

// ── Mini bottle for "how it works" section ────────────────────────────────
// Uses the original BottleCanvas SVG coordinates, scaled via viewBox
function MiniBottle({
  glowing = false,
  tilted = false,
  arriving = false,
}: {
  glowing?: boolean
  tilted?: boolean
  arriving?: boolean
}) {
  const glow = glowing || arriving
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        width: 64,
        height: 96,
        transform: tilted ? 'rotate(-22deg)' : undefined,
        flexShrink: 0,
      }}
    >
      {arriving && (
        <div
          style={{
            position: 'absolute',
            inset: -16,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(78,205,196,0.20) 0%, transparent 68%)',
          }}
        />
      )}
      <svg
        viewBox="0 0 160 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        width={64}
        height={96}
      >
        {/* Cork */}
        <rect x="54" y="8" width="52" height="24" rx="8" fill="#C4A882" />
        <rect x="62" y="13" width="36" height="5" rx="2.5" fill="rgba(255,255,255,0.20)" />
        <rect x="62" y="22" width="20" height="3" rx="1.5" fill="rgba(0,0,0,0.10)" />
        {/* Neck */}
        <path
          d="M60 32 L54 66 L106 66 L100 32 Z"
          fill="rgba(255,255,255,0.10)"
          stroke="rgba(255,255,255,0.20)"
          strokeWidth="1.5"
        />
        <path
          d="M62 36 L59 60"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Body */}
        <path
          d="M36 66 Q22 98 22 146 Q22 212 80 218 Q138 212 138 146 Q138 98 124 66 Z"
          fill={glow ? 'rgba(78,205,196,0.06)' : 'rgba(255,255,255,0.07)'}
          stroke={glow ? 'rgba(78,205,196,0.38)' : 'rgba(255,255,255,0.18)'}
          strokeWidth="2"
        />
        {/* Shine */}
        <path
          d="M40 82 Q34 116 34 146"
          stroke="rgba(255,255,255,0.24)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          d="M50 72 Q45 90 45 108"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Message scroll */}
        <rect x="54" y="96" width="52" height="76" rx="5" fill="rgba(247,231,206,0.11)" />
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1="63"
            y1={112 + i * 14}
            x2="97"
            y2={112 + i * 14}
            stroke="rgba(247,231,206,0.22)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ))}
        {/* Seafoam body tint */}
        <path
          d="M36 66 Q22 98 22 146 Q22 212 80 218 Q138 212 138 146 Q138 98 124 66 Z"
          fill="rgba(78,205,196,0.04)"
        />
      </svg>
    </div>
  )
}

// ── How-it-works beat ─────────────────────────────────────────────────────
function Beat({
  index,
  visual,
  heading,
  body,
  reduced,
}: {
  index: number
  visual: React.ReactNode
  heading: string
  body: string
  reduced: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-72px' })
  const flip = index % 2 === 1

  const visualVariants: Variants = reduced
    ? {}
    : {
        hidden: { opacity: 0, x: flip ? 14 : -14 },
        visible: {
          opacity: 1,
          x: 0,
          transition: { duration: 0.65, ease: EASE_OUT_QUART, delay: 0.05 },
        },
      }

  const textVariants: Variants = reduced
    ? {}
    : {
        hidden: { opacity: 0, x: flip ? -14 : 14 },
        visible: {
          opacity: 1,
          x: 0,
          transition: { duration: 0.65, ease: EASE_OUT_QUART, delay: 0.18 },
        },
      }

  const state = reduced ? 'visible' : inView ? 'visible' : 'hidden'

  return (
    <div
      ref={ref}
      className={`flex items-center gap-10 md:gap-16 ${
        flip ? 'flex-col md:flex-row-reverse' : 'flex-col md:flex-row'
      }`}
    >
      <motion.div
        className="flex justify-center flex-shrink-0"
        initial={reduced ? undefined : 'hidden'}
        animate={state}
        variants={visualVariants}
      >
        {visual}
      </motion.div>
      <motion.div
        className="text-center md:text-left"
        initial={reduced ? undefined : 'hidden'}
        animate={state}
        variants={textVariants}
      >
        <h3
          className="font-display text-2xl md:text-3xl text-sand mb-3"
          style={{ textWrap: 'balance' } as React.CSSProperties}
        >
          {heading}
        </h3>
        <p className="font-ui text-[15px] leading-[1.7] text-sand/70 max-w-[44ch] mx-auto md:mx-0">
          {body}
        </p>
      </motion.div>
    </div>
  )
}

// ── Received message preview ──────────────────────────────────────────────
function MessageCard({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section
      className="relative z-10 px-6 py-20"
      aria-label="An example message"
    >
      <div className="max-w-lg mx-auto">
        <motion.div
          ref={ref}
          className="rounded-2xl border border-sand/[0.09] bg-sand/[0.04] px-8 py-9 md:px-10"
          initial={reduced ? {} : { opacity: 0, y: 18 }}
          animate={inView || reduced ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: EASE_OUT_QUART }}
        >
          <div className="flex items-center gap-3 mb-7">
            <span
              className="text-xl select-none"
              role="img"
              aria-label="glass bottle"
            >
              🫙
            </span>
            <span className="font-ui text-[11px] text-sand/40 tracking-widest uppercase">
              Found you
            </span>
          </div>
          <blockquote>
            <p
              className="font-display text-xl md:text-2xl text-sand/90 leading-[1.6] mb-6"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              &ldquo;I finally told my sister what I&apos;d been meaning to say
              for three years. It went okay.&rdquo;
            </p>
            <footer className="font-ui text-sm text-sand/40">
              — a stranger, somewhere
            </footer>
          </blockquote>
        </motion.div>
      </div>
    </section>
  )
}

// ── Footer CTA ────────────────────────────────────────────────────────────
function FooterCTA({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <footer
      className="relative z-10 px-6 pt-20 pb-16 text-center"
      aria-label="Sign up"
    >
      <motion.div
        ref={ref}
        className="max-w-md mx-auto flex flex-col items-center gap-6 mb-14"
        initial={reduced ? {} : { opacity: 0, y: 16 }}
        animate={inView || reduced ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.65, ease: EASE_OUT_QUART }}
      >
        <h2
          className="font-display text-[clamp(1.75rem,5vw,2.75rem)] text-sand leading-[1.1]"
          style={{ textWrap: 'balance' } as React.CSSProperties}
        >
          Ready to throw your first bottle?
        </h2>
        <p className="font-ui text-base text-sand/60">
          One message. One stranger. Free, always.
        </p>
        <Link
          href="/sign-up"
          className="px-10 py-4 rounded-2xl bg-coral text-ocean-deep font-ui font-semibold text-base
                     tracking-wide transition-all duration-150 active:scale-[0.97] hover:brightness-110
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral
                     focus-visible:ring-offset-2 focus-visible:ring-offset-ocean-deep"
        >
          Create an account
        </Link>
      </motion.div>

      <nav aria-label="Footer" className="flex items-center justify-center gap-5">
        <Link
          href="/sign-in"
          className="font-ui text-xs text-sand/35 hover:text-sand/65 transition-colors duration-200"
        >
          Sign in
        </Link>
      </nav>
    </footer>
  )
}

// ── Landing page ──────────────────────────────────────────────────────────
export default function LandingPage() {
  const router = useRouter()
  const user = useAppSelector(selectUser)
  const isLoading = useAppSelector(selectIsLoading)
  const reduced = useReducedMotion() ?? false

  // Redirect authenticated users to the app
  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/home')
    }
  }, [user, isLoading, router])

  // Ocean counter
  const counterRef = useRef<HTMLDivElement>(null)
  const counterInView = useInView(counterRef, { once: true })
  const count = useCountUp(OCEAN_COUNT, counterInView, reduced)

  return (
    <div className="relative min-h-screen bg-ocean-deep text-sand overflow-x-hidden">
      <WaveBackground />

      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-7 pb-4 max-w-5xl mx-auto">
        <span className="font-display text-xl text-sand tracking-tight select-none">
          glassbottles
        </span>
        <Link
          href="/sign-in"
          className="font-ui text-sm text-sand/60 hover:text-sand/90 transition-colors duration-200
                     focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-seafoam
                     focus-visible:rounded px-1 -mx-1"
        >
          Sign in
        </Link>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        className="relative z-10 flex flex-col items-center justify-center px-6 pb-20 text-center"
        style={{ minHeight: 'calc(100svh - 64px)' }}
        aria-labelledby="hero-heading"
      >
        {/* Bottle — enters with its own built-in animation */}
        <div className="mb-10" aria-hidden="true">
          <BottleCanvas />
        </div>

        <motion.h1
          id="hero-heading"
          className="font-display text-sand leading-[1.08] tracking-[-0.02em] mb-6"
          style={{
            fontSize: 'clamp(2.25rem, 9vw, 4.5rem)',
            textWrap: 'balance',
          } as React.CSSProperties}
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_OUT_QUART, delay: reduced ? 0 : 0.2 }}
        >
          One bottle.
          <br />
          One stranger.
          <br />
          Every day.
        </motion.h1>

        <motion.p
          className="font-ui text-base md:text-lg text-sand/70 leading-relaxed max-w-[38ch] mb-10"
          style={{ textWrap: 'pretty' } as React.CSSProperties}
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT_QUART, delay: reduced ? 0 : 0.42 }}
        >
          Write an anonymous message. Send it to a stranger you&apos;ll never
          meet. See what washes up.
        </motion.p>

        <motion.div
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT_QUART, delay: reduced ? 0 : 0.6 }}
        >
          <Link
            href="/sign-up"
            className="inline-block px-10 py-4 rounded-2xl bg-coral text-ocean-deep font-ui
                       font-semibold text-base tracking-wide transition-all duration-150
                       active:scale-[0.97] hover:brightness-110 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2
                       focus-visible:ring-offset-ocean-deep"
          >
            Start throwing
          </Link>
        </motion.div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section
        className="relative z-10 px-6 py-20 max-w-2xl mx-auto flex flex-col gap-16 md:gap-20"
        aria-label="How glassbottles works"
      >
        <Beat
          index={0}
          visual={<MiniBottle glowing />}
          heading="Write something honest."
          body="Say anything. No one knows it's you. Your words, unchained from your name."
          reduced={reduced}
        />
        <Beat
          index={1}
          visual={<MiniBottle tilted />}
          heading="Throw it to the sea."
          body="One bottle per day. No replies. No profiles. No algorithm deciding who deserves to read it."
          reduced={reduced}
        />
        <Beat
          index={2}
          visual={<MiniBottle arriving />}
          heading="See what washes up."
          body="Tomorrow, someone else's bottle might find you. Serendipity, not feed."
          reduced={reduced}
        />
      </section>

      {/* ── Ocean counter ─────────────────────────────────────────────── */}
      <div
        ref={counterRef}
        className="relative z-10 py-14 text-center border-y border-seafoam/[0.08]"
        role="complementary"
        aria-label="Bottles at sea"
      >
        <p
          className="font-display text-sand tabular-nums leading-none mb-2"
          style={{ fontSize: 'clamp(2.5rem, 8vw, 4rem)' }}
          aria-live="polite"
          aria-atomic="true"
        >
          {counterInView ? count.toLocaleString() : '—'}
        </p>
        <p className="font-ui text-sm text-sand/45 tracking-wide">
          bottles adrift right now
        </p>
      </div>

      {/* ── Message in a bottle ───────────────────────────────────────── */}
      <MessageCard reduced={reduced} />

      {/* ── Footer CTA ───────────────────────────────────────────────── */}
      <FooterCTA reduced={reduced} />
    </div>
  )
}
