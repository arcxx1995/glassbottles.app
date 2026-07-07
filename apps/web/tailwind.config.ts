import type { Config } from 'tailwindcss'

// ─── glassbottles design tokens (canonical) ──────────────────────────────────
//
// Motion tokens — Framer Motion spring (use directly in transition prop):
//   reveal-bottle:  { type: 'spring', stiffness: 80, damping: 12 }
//   receive-spring: { type: 'spring', stiffness: 320, damping: 28 }
//
// CSS keyframe tokens (use via animation utilities below):
//   throw-arc:      TetheredBottle wind-up + arc + splash, 1.15s (motion keyframes)
//   wave-ambient:   sinusoidal 4s linear loop (3 staggered layers)
//   bottle-bob:     y -10px, rotate ±1.2deg, 3.2s ease-in-out (Framer Motion)
//   reveal-words:   staggered 40ms/word, delay cap 1.4s, 280ms easeOut per word
//   shimmer:        translateX -100%→100%, 1.6s ease-in-out infinite
//   skeleton-pulse: opacity 1→0.4→1, 1.8s ease-in-out infinite
//
// Spacing — 4px base grid:
//   Use multiples of 4 for all spacing (Tailwind: 1=4px, 2=8px, 3=12px…)
//   Card padding:   p-5 (20px) mobile / p-6 (24px) desktop
//   Section gap:    gap-8 (32px) standard / gap-6 (24px) tight
//   Page top:       pt-14 (56px) — clears status bar on mobile
//   Nav height:     h-16 (64px) — pb-20 (80px) content clearance
// ─────────────────────────────────────────────────────────────────────────────

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Core palette
        'ocean-deep': '#0A1628',   // primary bg — deepest ocean
        'ocean-mid':  '#0D2137',   // card / surface bg
        seafoam:      '#4ECDC4',   // primary accent — active states, icons
        sand:         '#F7E7CE',   // text, highlights — warm readable
        coral:        '#FF6B6B',   // CTA — throw button ONLY, destructive
        glass:        'rgba(255,255,255,0.08)',  // bottle material, frosted surfaces
        foam:         'rgba(255,255,255,0.04)',  // subtle backgrounds, dividers
        // Semantic aliases (for Ishan's component work)
        'surface-1':  '#0D2137',   // == ocean-mid: card bg
        'surface-0':  '#0A1628',   // == ocean-deep: page bg
        'text-primary':   '#F7E7CE',              // == sand
        'text-secondary': 'rgba(247,231,206,0.5)', // sand/50
        'text-tertiary':  'rgba(247,231,206,0.25)',// sand/25
        'border-subtle':  'rgba(255,255,255,0.05)',// white/5 — card borders
        'border-active':  'rgba(78,205,196,0.30)', // seafoam/30 — focus rings
      },
      fontFamily: {
        // display: bottle content, hero headings, page titles
        display: ['var(--font-display)', 'Playfair Display', 'Georgia', 'serif'],
        // ui: all chrome — labels, buttons, nav, body copy
        ui:      ['var(--font-ui)', 'DM Sans', 'system-ui', 'sans-serif'],
        // mono: timestamps, character counts, metadata, reference codes
        mono:    ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        // Consistent radius vocabulary
        'card':   '1.5rem',  // 24px — cards, modals, large surfaces
        'button': '1rem',    // 16px — CTAs
        'chip':   '0.75rem', // 12px — badges, tags
        'input':  '1.5rem',  // 24px — form inputs
      },
      keyframes: {
        // wave-ambient: CSS-driven scroll for WaveBackground layers
        // Implementation: 3 layers at 8s/11s/14s with linear repeat
        // (Framer Motion handles this in WaveBackground.tsx via x: ['0%','-50%'])
        'wave-ambient': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        // bottle-bob: canonical idle animation values
        // NOTE: BottleCanvas.tsx uses Framer Motion for this with:
        //   y: [0, -10, 0], rotate: [-1.2, 1.2, -1.2], duration: 3.2s
        // This CSS version is available for reduced-motion fallback only
        'bottle-bob': {
          '0%, 100%': { transform: 'translateY(0px) rotate(-1.2deg)' },
          '50%': { transform: 'translateY(-10px) rotate(1.2deg)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // shimmer: loading state sweep — more expressive than plain pulse
        // Use on skeleton elements over ocean-mid background
        'shimmer': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        // skeleton-pulse: gentler opacity cycle for skeleton placeholders
        'skeleton-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
        // reveal-up: standard content entrance
        'reveal-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        // scale-in: for badges, counters appearing
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.75)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'wave-ambient':   'wave-ambient 4s ease-in-out infinite',
        'bottle-bob':     'bottle-bob 3.2s ease-in-out infinite',
        'fade-in':        'fade-in 0.3s ease-out forwards',
        'shimmer':        'shimmer 1.6s ease-in-out infinite',
        'skeleton-pulse': 'skeleton-pulse 1.8s ease-in-out infinite',
        'reveal-up':      'reveal-up 0.4s cubic-bezier(0.25,0.46,0.45,0.94) forwards',
        'scale-in':       'scale-in 0.25s cubic-bezier(0.25,0.46,0.45,0.94) forwards',
      },
      transitionTimingFunction: {
        // Named easing curves for use in transition-[timing] utilities
        'throw-arc':  'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'ease-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        'ease-back':  'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      boxShadow: {
        // Component shadow vocabulary
        'card':    '0 4px 24px rgba(0,0,0,0.3)',
        'banner':  '0 8px 32px rgba(0,0,0,0.4)',
        'seafoam': '0 0 16px rgba(78,205,196,0.25)',
        'coral':   '0 0 16px rgba(255,107,107,0.30)',
        'glow-sm': '0 0 10px rgba(78,205,196,0.55)',
        'glow-md': '0 0 20px rgba(78,205,196,0.35)',
      },
    },
  },
  plugins: [],
}

export default config
