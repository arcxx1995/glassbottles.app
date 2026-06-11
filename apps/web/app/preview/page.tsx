'use client'

/**
 * /preview — Dev-only visual regression page.
 *
 * Renders every home-page bottle UI state, tab-switchable. No auth required —
 * /preview is deliberately absent from the middleware matcher list.
 *
 * Each panel gets an isolated Redux Provider seeded with exactly the state it
 * needs. RTK Query endpoints are included so mutation-calling components don't
 * throw on mount (mutations 401 in preview — fine).
 */

import { useState, useCallback } from 'react'
import { useAppDispatch } from '@/store'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'

// Slices
import authReducer from '@/store/authSlice'
import bottleReducer from '@/store/bottleSlice'
import uiReducer, { setShowReceivedBanner, setShowDeliveredBanner } from '@/store/uiSlice'
import { bottleApi } from '@/store/api/bottleApi'
import { authApi } from '@/store/api/authApi'

// Components
import WaveBackground from '@/components/shared/WaveBackground'
import DailyTimer from '@/components/shared/DailyTimer'
import MessageEditor from '@/components/bottle/MessageEditor'
import SailingSea, { type SailingBottleItem } from '@/components/bottle/SailingSea'

const BottleCanvas = dynamic(
  () => import('@/components/bottle/BottleCanvas'),
  { ssr: false }
)

const ThrowAnimation = dynamic(
  () => import('@/components/bottle/ThrowAnimation'),
  { ssr: false }
)

const ReceivedBottle = dynamic(
  () => import('@/components/bottle/ReceivedBottle'),
  { ssr: false }
)

const ReceivedBannerDynamic = dynamic(
  () => import('@/components/shared/ReceivedBanner'),
  { ssr: false }
)

const DeliveredBannerDynamic = dynamic(
  () => import('@/components/shared/DeliveredBanner'),
  { ssr: false }
)

// ─── Mock store factory ──────────────────────────────────────────────────────

interface MockStoreOpts {
  sendStatus?: 'idle' | 'composing' | 'throwing' | 'thrown'
  message?: string
}

function makeMockStore({
  sendStatus = 'idle',
  message = '',
}: MockStoreOpts = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
      bottle: bottleReducer,
      ui: uiReducer,
      [bottleApi.reducerPath]: bottleApi.reducer,
      [authApi.reducerPath]: authApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware()
        .concat(bottleApi.middleware)
        .concat(authApi.middleware),
    preloadedState: {
      auth: {
        user: null, // no real user in preview
        isLoading: false,
        isOnboarded: false,
      },
      bottle: {
        sendStatus,
        receiveStatus: 'idle' as const,
        isAnimating: sendStatus === 'throwing',
        message,
      },
      ui: {
        isReportModalOpen: false,
        activeBottleId: null,
        showReceivedBanner: false,
        showDeliveredBanner: false,
      },
    },
  })
}

// ─── Panel definitions ───────────────────────────────────────────────────────

const PANEL_IDS = [
  'idle',
  'composing',
  'throwing',
  'sailing',
  'received',
  'received-banner',
] as const

type PanelId = (typeof PANEL_IDS)[number]

const PANEL_LABELS: Record<PanelId, string> = {
  'idle': 'Idle',
  'composing': 'Composing',
  'throwing': 'Throwing',
  'sailing': 'Sailing + Delivery',
  'received': 'Received',
  'received-banner': 'Received Toast',
}

// ─── Individual state panels ─────────────────────────────────────────────────

function IdlePanel() {
  const store = makeMockStore({ sendStatus: 'idle' })
  return (
    <Provider store={store}>
      <div className="flex flex-col items-center gap-8 w-full">
        <BottleCanvas />
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="font-display text-xl text-sand">Your bottle awaits</p>
          <p className="font-ui text-sm text-sand/50 max-w-[260px] leading-relaxed">
            Write something for a stranger. They won&apos;t know it&apos;s you.
          </p>
          <button
            className="mt-3 px-10 py-4 rounded-2xl bg-coral text-ocean-deep font-ui
                       font-semibold text-base tracking-wide transition-all duration-150
                       active:scale-[0.97] hover:brightness-110"
          >
            Write a message
          </button>
        </div>
      </div>
    </Provider>
  )
}

function ComposingPanel() {
  const store = makeMockStore({
    sendStatus: 'composing',
    message: 'Sometimes I wonder if anyone else feels like a stranger in their own life…',
  })
  return (
    <Provider store={store}>
      <div className="flex flex-col items-center gap-6 w-full">
        <BottleCanvas />
        <MessageEditor className="w-full" onReady={() => undefined} />
        <button className="font-ui text-xs text-sand/30 hover:text-sand/60 transition-colors">
          Cancel
        </button>
      </div>
    </Provider>
  )
}

function ThrowingPanel() {
  const [key, setKey] = useState(0)
  const store = makeMockStore({ sendStatus: 'throwing' })

  const handleComplete = useCallback(() => {
    // Restart the animation after a short pause so it loops in preview
    setTimeout(() => setKey((k) => k + 1), 600)
  }, [])

  return (
    <Provider store={store}>
      <div className="flex flex-col items-center w-full">
        <ThrowAnimation key={key} onComplete={handleComplete} />
      </div>
    </Provider>
  )
}

// Sailing panel: multiple floating bottles + the persistent delivery toast.
// "Simulate a delivery" removes a random bottle (mirrors the real refetch that
// drops the matched bottle) and fires the delivered banner.

const INITIAL_SAILING: SailingBottleItem[] = [
  { id: 's1', day_key: '2026-06-11' },
  { id: 's2', day_key: '2026-06-10' },
  { id: 's3', day_key: '2026-06-08' },
  { id: 's4', day_key: '2026-06-05' },
  { id: 's5', day_key: '2026-06-01' },
]

function SailingControls({
  onDeliver,
  count,
}: {
  onDeliver: () => void
  count: number
}) {
  const dispatch = useAppDispatch()
  return (
    <button
      disabled={count === 0}
      onClick={() => {
        onDeliver()
        dispatch(setShowDeliveredBanner(true))
      }}
      className="px-7 py-3 rounded-2xl bg-seafoam text-ocean-deep font-ui font-semibold
                 text-sm tracking-wide transition-all duration-150 active:scale-[0.97]
                 hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none"
    >
      Simulate a delivery
    </button>
  )
}

function SailingPanel() {
  const [store] = useState(() => makeMockStore({ sendStatus: 'thrown' }))
  const [bottles, setBottles] = useState<SailingBottleItem[]>(INITIAL_SAILING)

  const deliverOne = useCallback(() => {
    setBottles((prev) => {
      if (prev.length === 0) return prev
      const i = Math.floor(Math.random() * prev.length)
      return prev.filter((_, idx) => idx !== i)
    })
  }, [])

  return (
    <Provider store={store}>
      {/* Persistent toast — lives on the sailing screen until dismissed */}
      <DeliveredBannerDynamic />

      <div className="flex flex-col items-center gap-8 text-center w-full pt-2">
        <div className="flex flex-col gap-2">
          <p className="font-display text-2xl text-sand">Still sailing</p>
          <p className="font-ui text-sm text-sand/50 max-w-[260px] mx-auto leading-relaxed">
            {bottles.length} bottle{bottles.length === 1 ? '' : 's'} drifting through
            the ocean, waiting to be found.
          </p>
        </div>

        <SailingSea bottles={bottles} />

        <SailingControls onDeliver={deliverOne} count={bottles.length} />
        <DailyTimer />
      </div>
    </Provider>
  )
}

const MOCK_RECEIVED_BOTTLE = {
  id: 'preview-bottle-001',
  message:
    'I left a note in a library book once. It said "this page changed my life" — and I never found out if anyone read it. I hope someone did.',
  sent_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  received_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  read_at: null,
  is_read: false,
  is_reported: false,
  is_stale: false,
  day_key: new Date().toISOString().slice(0, 10),
}

function ReceivedPanel() {
  const store = makeMockStore({ sendStatus: 'idle' })
  return (
    <Provider store={store}>
      <div className="w-full flex flex-col gap-4">
        <div className="text-center mb-2">
          <p className="font-display text-xl text-sand">Your inbox</p>
          <p className="font-ui text-xs text-sand/40 mt-1">1 unread bottle</p>
        </div>
        <ReceivedBottle bottle={MOCK_RECEIVED_BOTTLE} />
      </div>
    </Provider>
  )
}

function ReceivedBannerTriggerButton() {
  const dispatch = useAppDispatch()
  return (
    <button
      onClick={() => dispatch(setShowReceivedBanner(true))}
      className="px-8 py-3.5 rounded-2xl bg-seafoam text-ocean-deep font-ui
                 font-semibold text-sm tracking-wide transition-all duration-150
                 active:scale-[0.97] hover:brightness-110"
    >
      Trigger banner
    </button>
  )
}

function ReceivedBannerPanel() {
  const store = makeMockStore({ sendStatus: 'idle' })
  return (
    <Provider store={store}>
      {/* ReceivedBanner is fixed-position — renders top-right of the viewport */}
      <ReceivedBannerDynamic />
      <div className="flex flex-col items-center gap-6 text-center pt-16 px-4">
        <div className="flex flex-col gap-1">
          <p className="font-display text-xl text-sand">Received toast</p>
          <p className="font-ui text-sm text-sand/50 max-w-[260px] leading-relaxed">
            Fires when a bottle is delivered to you live. Auto-dismisses after 5
            seconds. Tap to go to inbox (real nav).
          </p>
        </div>
        <ReceivedBannerTriggerButton />
      </div>
    </Provider>
  )
}

// ─── Panel registry ──────────────────────────────────────────────────────────

const PANELS: Record<PanelId, React.FC> = {
  'idle': IdlePanel,
  'composing': ComposingPanel,
  'throwing': ThrowingPanel,
  'sailing': SailingPanel,
  'received': ReceivedPanel,
  'received-banner': ReceivedBannerPanel,
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PreviewPage() {
  const [activePanel, setActivePanel] = useState<PanelId>('idle')

  const ActivePanel = PANELS[activePanel]

  return (
    <>
      <WaveBackground />

      <div className="relative z-10 min-h-screen flex flex-col">

        {/* DEV PREVIEW banner */}
        <div
          className="w-full flex items-center justify-center gap-3 py-2 px-4
                     bg-coral/90 text-ocean-deep"
          role="banner"
        >
          <span className="font-mono text-xs font-semibold tracking-widest uppercase">
            DEV PREVIEW
          </span>
          <span className="font-ui text-xs opacity-70">
            — no auth, mock state, no real API calls
          </span>
        </div>

        {/* Tab strip */}
        <div
          className="sticky top-0 z-20 w-full bg-ocean-deep/90 backdrop-blur-md
                     border-b border-white/5 overflow-x-auto"
        >
          <div className="flex items-center gap-1 px-4 py-3 min-w-max mx-auto">
            {PANEL_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setActivePanel(id)}
                className={[
                  'px-3 py-1.5 rounded-chip font-ui text-xs font-medium whitespace-nowrap',
                  'transition-all duration-150',
                  activePanel === id
                    ? 'bg-seafoam text-ocean-deep shadow-seafoam'
                    : 'text-sand/50 hover:text-sand hover:bg-white/5',
                ].join(' ')}
              >
                {PANEL_LABELS[id]}
              </button>
            ))}
          </div>
        </div>

        {/* State label */}
        <div className="w-full max-w-md mx-auto px-5 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-[10px] text-seafoam bg-seafoam/10
                         px-2 py-0.5 rounded-full tracking-wider uppercase"
            >
              state
            </span>
            <span className="font-mono text-xs text-sand/60">
              {activePanel}
            </span>
          </div>
        </div>

        {/* Panel content */}
        <div className="flex-1 w-full max-w-md mx-auto px-5 pb-20">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePanel}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <ActivePanel />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer nav hint */}
        <div className="sticky bottom-0 w-full border-t border-white/5 bg-ocean-deep/80 backdrop-blur-md py-3">
          <p className="font-mono text-[10px] text-sand/20 text-center tracking-wide">
            {PANEL_IDS.indexOf(activePanel) + 1} / {PANEL_IDS.length}
            {' '}—{' '}
            {PANEL_LABELS[activePanel]}
          </p>
        </div>

      </div>
    </>
  )
}
