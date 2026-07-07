'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion, useInView, type Variants } from 'motion/react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useAppSelector } from '@/store'
import { selectUser, selectIsLoading } from '@/store/authSlice'
import { useGetPublicStatsQuery, type PublicStats } from '@/store/api/bottleApi'
import WaveBackground from '@/components/shared/WaveBackground'
import NightSky from '@/components/shared/NightSky'
import { Github, Star } from 'lucide-react'
import { FAQ_ITEMS } from './faq-data'

const BottleCanvas = dynamic(
  () => import('@/components/bottle/BottleCanvas'),
  { ssr: false }
)

// ── Constants ─────────────────────────────────────────────────────────────
const EASE_OUT_QUART = [0.25, 1, 0.5, 1] as const

// Public Spotify playlist for the landing-page soundtrack. Paste only the ID
// from the share link: https://open.spotify.com/playlist/<THIS_PART>?si=...
const SPOTIFY_PLAYLIST_ID = '0PNQlJpYD7qkyBGlK6gNUV'

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
    let cancelled = false
    const start = Date.now()
    function tick() {
      if (cancelled) return
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 4)
      setValue(Math.round(eased * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      cancelled = true
    }
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

// ── Scroll reveal (the one animation idiom for landing sections) ──────────
// MotionConfig reducedMotion="user" (root) strips the y-slide for reduced
// users automatically, leaving a plain crossfade.
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: EASE_OUT_QUART, delay }}
    >
      {children}
    </motion.div>
  )
}

// ── What washes ashore — a small wall of example messages ─────────────────
// ILLUSTRATIVE, not real user messages (real bottles are private between
// sender and finder — we couldn't quote them if we wanted to). The closing
// caption in QuoteWall says so on the page; keep it if you edit these.
const SHORE_QUOTES = [
  {
    text: 'I finally told my sister what I’d been meaning to say for three years. It went okay.',
    primary: true,
  },
  {
    text: 'Someone in another timezone knows the thing I can’t say out loud. We will never meet. Somehow that makes it lighter.',
    primary: false,
  },
  {
    text: 'I threw a bottle about my dad. Today a stranger’s bottle about their dad washed up. The ocean has a sense of humour.',
    primary: false,
  },
] as const

function QuoteWall() {
  return (
    <section className="relative z-10 px-6 py-16" aria-label="Example messages">
      <div className="max-w-lg mx-auto flex flex-col gap-8">
        <Reveal>
          <h2
            className="font-display text-2xl md:text-3xl text-sand text-center"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            What washes ashore
          </h2>
        </Reveal>

        {/* Primary card — the app's received-bottle framing. */}
        <Reveal delay={0.08}>
          <div className="rounded-2xl border border-sand/[0.09] bg-sand/[0.04] px-8 py-9 md:px-10">
            <div className="flex items-center gap-3 mb-7">
              <span className="select-none inline-flex" role="img" aria-label="glass bottle">
                {/* Same wiggling bottle as the hero title. */}
                <BottleCanvas size="1.5rem" />
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
                &ldquo;{SHORE_QUOTES[0].text}&rdquo;
              </p>
              <footer className="font-ui text-sm text-sand/40">— a stranger, somewhere</footer>
            </blockquote>
          </div>
        </Reveal>

        {/* Two quieter quotes drift off the card — bare text, offset like flotsam. */}
        <Reveal delay={0.14} className="self-start max-w-[85%]">
          <blockquote className="border-none">
            <p className="font-display text-lg text-sand/70 leading-[1.65]">
              &ldquo;{SHORE_QUOTES[1].text}&rdquo;
            </p>
            <footer className="font-ui text-xs text-sand/30 mt-3">— adrift 4 days before landing</footer>
          </blockquote>
        </Reveal>
        <Reveal delay={0.2} className="self-end max-w-[85%] text-right">
          <blockquote className="border-none">
            <p className="font-display text-lg text-sand/70 leading-[1.65]">
              &ldquo;{SHORE_QUOTES[2].text}&rdquo;
            </p>
            <footer className="font-ui text-xs text-sand/30 mt-3">— found at 2:14 am</footer>
          </blockquote>
        </Reveal>

        {/* Honesty note: these are illustrations. Real bottles are private —
            only the sender and the finder ever see them. */}
        <Reveal delay={0.24}>
          <p className="font-ui text-[11px] text-sand/30 text-center leading-relaxed">
            The kind of thing that washes ashore. Real bottles stay between
            you and the stranger who finds them.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

// ── Why anonymous — the trust section ──────────────────────────────────────
const ANON_POINTS = [
  {
    heading: 'No names in the water.',
    body: 'A bottle carries your words and nothing else — no handle, no avatar, no history. The stranger who finds it can’t follow you, look you up, or write back.',
  },
  {
    heading: 'One bottle a day, by design.',
    body: 'The limit isn’t a paywall — it’s the point. When you only get one, you say the thing that actually matters.',
  },
  {
    heading: 'The tide is watched.',
    body: 'Anything cruel can be reported and is pulled from the water. Anonymity protects the writer, never the abuse.',
  },
] as const

function WhyAnonymous() {
  return (
    <section className="relative z-10 px-6 py-16" aria-label="Why glassbottles is anonymous">
      <div className="max-w-lg mx-auto flex flex-col gap-10">
        <Reveal>
          <h2
            className="font-display text-2xl md:text-3xl text-sand text-center"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            Anonymous, on purpose
          </h2>
        </Reveal>
        {ANON_POINTS.map((point, i) => (
          <Reveal key={point.heading} delay={0.06 + i * 0.06}>
            <h3 className="font-display text-xl text-sand mb-2">{point.heading}</h3>
            <p className="font-ui text-[15px] leading-[1.7] text-sand/70 max-w-[52ch]">
              {point.body}
            </p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

// ── FAQ — native <details>, no JS accordion ────────────────────────────────
// Copy lives in faq-data.ts so the FAQPage JSON-LD (page.tsx) stays in sync.

function FAQ() {
  return (
    <section className="relative z-10 px-6 py-16" aria-label="Frequently asked questions">
      <div className="max-w-lg mx-auto">
        <Reveal>
          <h2 className="font-display text-2xl md:text-3xl text-sand text-center mb-8">
            Questions from the shore
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="flex flex-col divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {FAQ_ITEMS.map((item) => (
              <details key={item.q} className="group py-4">
                <summary
                  className="flex items-center justify-between gap-4 cursor-pointer list-none
                             font-ui text-[15px] text-sand/85 [&::-webkit-details-marker]:hidden"
                >
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-seafoam/70 transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="font-ui text-sm leading-[1.7] text-sand/55 pt-3 max-w-[56ch]">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ── Soundtrack ────────────────────────────────────────────────────────────
// A public Spotify playlist embedded for ambient listening — plain iframe, no
// API or keys. Full-height embed so the track list is visible and individually
// playable. Spotify-logged-in visitors hear full tracks; others get 30s
// previews (a Spotify limitation, not ours). The embed is a sealed third party:
// it never receives anything about the visitor's bottles or identity, so it
// cannot touch the app's anonymity.
function Soundtrack({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section className="relative z-10 px-4 py-12 sm:px-6" aria-label="Soundtrack">
      <div className="max-w-lg mx-auto">
        <motion.div
          ref={ref}
          className="overflow-hidden rounded-[1.75rem] border border-seafoam/20
                     bg-ocean-mid/55 backdrop-blur-md shadow-[0_12px_48px_-16px_rgba(0,0,0,0.55)]"
          initial={reduced ? {} : { opacity: 0, y: 18 }}
          animate={inView || reduced ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: EASE_OUT_QUART }}
        >
          {/* Site chrome wrapped around Spotify's player — the bottle, the
              display font and the seafoam accent make it read as our own. */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
            <span className="shrink-0 select-none" aria-hidden="true">
              <BottleCanvas size="1.4rem" />
            </span>
            <span className="font-display text-lg text-sand leading-tight">
              Music while you drift
            </span>
            <span
              className="ml-auto h-2 w-2 rounded-full bg-seafoam/70 shadow-[0_0_8px_rgba(78,205,196,0.7)]"
              aria-hidden="true"
            />
          </div>

          {/* Spotify embed (dark theme) nested flush inside the card */}
          <iframe
            title="glassbottles soundtrack on Spotify"
            src={`https://open.spotify.com/embed/playlist/${SPOTIFY_PLAYLIST_ID}?theme=0`}
            width="100%"
            height={352}
            style={{ border: 0, display: 'block' }}
            loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          />
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
      className="relative z-10 px-6 pt-16 pb-12 text-center"
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
          className="px-10 py-4 rounded-2xl bg-seafoam text-ocean-deep font-ui font-semibold text-base
                     tracking-wide transition-all duration-150 active:scale-[0.97] hover:brightness-110
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam
                     focus-visible:ring-offset-2 focus-visible:ring-offset-ocean-deep"
        >
          Create an account
        </Link>
      </motion.div>

      <nav aria-label="Footer" className="flex items-center justify-center gap-6 flex-wrap">
        <Link
          href="/sign-in"
          className="font-ui text-xs text-sand/35 hover:text-sand/65 transition-colors duration-200"
        >
          Sign in
        </Link>
        <a
          href="https://github.com/arcxx1995/glassbottles.app"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Star glassbottles on GitHub"
          className="inline-flex items-center gap-1.5 rounded-full border border-sand/15
                     bg-sand/[0.04] px-3 py-1.5 font-ui text-xs text-sand/45
                     hover:border-seafoam/35 hover:text-seafoam transition-all duration-200"
        >
          <Github size={13} strokeWidth={1.6} aria-hidden="true" />
          <Star size={11} strokeWidth={1.8} aria-hidden="true" className="fill-current opacity-80" />
          <span>Star on GitHub</span>
        </a>
      </nav>
    </footer>
  )
}

// ── Landing page ──────────────────────────────────────────────────────────
export default function LandingPage({ initialStats }: { initialStats: PublicStats }) {
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

  // initialStats is SSR-fetched by the server component wrapper — numbers are
  // available on first paint. RTK Query re-fetches in the background to pick up
  // any change since the server rendered the page; once it resolves, live data
  // takes over. displayStats is never undefined so the counter never shows '—'.
  const { data: liveStats } = useGetPublicStatsQuery()
  const displayStats = liveStats ?? initialStats
  const counterRef = useRef<HTMLDivElement>(null)
  const counterInView = useInView(counterRef, { once: true })
  const count = useCountUp(displayStats.adriftCount, counterInView, reduced)
  const totalCount = useCountUp(displayStats.totalCount, counterInView, reduced)

  return (
    <div className="relative min-h-screen bg-ocean-deep text-sand overflow-x-hidden">
      <WaveBackground />
      {/* Night sky over the hero — galaxy, crescent moon, twinkling stars,
          occasional shooting stars. Sits above the ocean gradient, behind
          all content. */}
      <NightSky />

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
        className="relative z-10 flex flex-col items-center justify-center px-6 pb-12 text-center"
        style={{ minHeight: 'calc(100svh - 64px)' }}
        aria-labelledby="hero-heading"
      >
        <motion.h1
          id="hero-heading"
          aria-label="One bottle. One stranger. Every day."
          className="font-display text-sand leading-[1.08] tracking-[-0.02em] mb-6"
          style={{
            fontSize: 'clamp(2.25rem, 9vw, 4.5rem)',
            textWrap: 'balance',
          } as React.CSSProperties}
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_OUT_QUART, delay: reduced ? 0 : 0.2 }}
        >
          {/* The "o" in "bottle" is the wiggling bottle itself. */}
          One b
          <span
            aria-hidden="true"
            style={{ display: 'inline-block', verticalAlign: '-0.22em', margin: '0 0.02em' }}
          >
            <BottleCanvas size="0.62em" />
          </span>
          ttle.
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
            className="inline-block px-10 py-4 rounded-2xl bg-seafoam text-ocean-deep font-ui
                       font-semibold text-base tracking-wide transition-all duration-150
                       active:scale-[0.97] hover:brightness-110 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-seafoam focus-visible:ring-offset-2
                       focus-visible:ring-offset-ocean-deep"
          >
            Start throwing
          </Link>
        </motion.div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section
        className="relative z-10 px-6 py-16 max-w-2xl mx-auto flex flex-col gap-10 md:gap-14"
        aria-label="How glassbottles works"
      >
        <Reveal>
          <h2
            className="font-display text-2xl md:text-3xl text-sand text-center"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            A message in a bottle, online
          </h2>
          <p className="font-ui text-[15px] leading-[1.7] text-sand/70 max-w-[52ch] mx-auto mt-3 text-center">
            glassbottles is a digital message in a bottle: you throw one
            anonymous message into the sea each day, and the tide carries a
            stranger&apos;s bottle back to you. Here&apos;s how it works.
          </p>
        </Reveal>
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
        className="relative z-10 py-10 text-center border-y border-seafoam/[0.08]"
        role="complementary"
        aria-label="Bottles at sea"
      >
        <p
          className="font-display text-sand tabular-nums leading-none mb-2"
          style={{ fontSize: 'clamp(2.5rem, 8vw, 4rem)' }}
          aria-live="polite"
          aria-atomic="true"
        >
          {counterInView ? count.toLocaleString() : displayStats.adriftCount.toLocaleString()}
        </p>
        <p className="font-ui text-sm text-sand/45 tracking-wide">
          bottles adrift right now
        </p>

        {/* Cumulative total — same display size as the adrift counter above. */}
        <p
          className="font-display text-sand tabular-nums leading-none mb-2 mt-10"
          style={{ fontSize: 'clamp(2.5rem, 8vw, 4rem)' }}
          aria-live="polite"
          aria-atomic="true"
        >
          {counterInView ? totalCount.toLocaleString() : displayStats.totalCount.toLocaleString()}
        </p>
        <p className="font-ui text-sm text-sand/45 tracking-wide">
          bottles in the sea till now
        </p>
      </div>

      {/* ── Messages that washed ashore ───────────────────────────────── */}
      <QuoteWall />

      {/* ── Why anonymous ─────────────────────────────────────────────── */}
      <WhyAnonymous />

      {/* ── Soundtrack ────────────────────────────────────────────────── */}
      <Soundtrack reduced={reduced} />

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <FAQ />

      {/* ── Footer CTA ───────────────────────────────────────────────── */}
      <FooterCTA reduced={reduced} />

    </div>
  )
}
