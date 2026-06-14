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

import { useState, useCallback, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'

// Slices
import authReducer from '@/store/authSlice'
import bottleReducer from '@/store/bottleSlice'
import uiReducer from '@/store/uiSlice'
import { bottleApi } from '@/store/api/bottleApi'
import { authApi } from '@/store/api/authApi'

// Components
import WaveBackground from '@/components/shared/WaveBackground'
import DailyTimer from '@/components/shared/DailyTimer'
import MessageEditor from '@/components/bottle/MessageEditor'
import SailingSea, { type SailingBottleItem } from '@/components/bottle/SailingSea'

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
        receivedBannerDismissedIds: [],
      },
    },
  })
}

// ─── Panel definitions ───────────────────────────────────────────────────────

const PANEL_IDS = [
  'idle',
  'throwing',
  'sailing',
  'received',
  'received-banner',
] as const

type PanelId = (typeof PANEL_IDS)[number]

const PANEL_LABELS: Record<PanelId, string> = {
  'idle': 'Idle',
  'throwing': 'Throwing (Drop)',
  'sailing': 'Sailing + Delivery',
  'received': 'Received',
  'received-banner': 'Received Toast',
}

// ─── Shared mock day keys ────────────────────────────────────────────────────

const dayKeyAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const TODAY_KEY = dayKeyAgo(0)

// A few older bottles still drifting from previous days — always visible on the
// idle screen, behind the compose box.
const OLD_SAILING: SailingBottleItem[] = [
  { id: 'old-1', day_key: dayKeyAgo(2) },
  { id: 'old-2', day_key: dayKeyAgo(4) },
  { id: 'old-3', day_key: dayKeyAgo(6) },
]

// ─── Individual state panels ─────────────────────────────────────────────────

function IdlePanel() {
  const store = makeMockStore({ sendStatus: 'idle' })
  return (
    <Provider store={store}>
      {/* Continuous sea — older bottles drift behind the compose box. */}
      <SailingSea bottles={OLD_SAILING} />

      {/* Foreground: heading + wider compose box with the bottle tethered
          beneath it by the nail + rope — mirrors the real /home idle screen. */}
      <div className="relative z-10 w-full min-h-[520px] flex flex-col items-center">
        <div className="text-center">
          <p className="font-display text-xl text-sand">Your bottle awaits</p>
          <p className="font-ui text-xs text-sand/55 max-w-[240px] mx-auto leading-relaxed mt-1">
            Write something for a stranger. They won&apos;t know it&apos;s you.
          </p>
        </div>
        <div className="relative w-[94%] max-w-[420px] mt-6">
          <MessageEditor onReady={() => undefined} />
        </div>

        {/* Always-on sailing copy, coexisting with the compose box. */}
        <div className="mt-10 text-center">
          <p className="font-ui text-sm text-sand/60 max-w-[260px] mx-auto leading-relaxed">
            {OLD_SAILING.length} bottles drifting through the ocean, waiting to be
            found.
          </p>
        </div>
      </div>
    </Provider>
  )
}

// Loops idle → drop → sailing so the rope-fall, bottle drop, and the seamless
// hand-off into the fixed-spot sailing bottle can be inspected. Each cycle
// remounts the tether in `idle`, flips to `dropping` after a beat, then on drop
// completion reveals the "today" bottle resting at the fixed drop location.
function ThrowingPanel() {
  const [store] = useState(() => makeMockStore({ sendStatus: 'throwing' }))
  const [cycle, setCycle] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'dropping' | 'sailing'>('idle')

  useEffect(() => {
    setPhase('idle')
    const t = setTimeout(() => setPhase('dropping'), 1100)
    return () => clearTimeout(t)
  }, [cycle])

  const handleComplete = useCallback(() => {
    setPhase('sailing')
    setTimeout(() => setCycle((c) => c + 1), 2000)
  }, [])

  const showCompose = phase === 'idle' || phase === 'dropping'
  // After the box bottle vanishes, the "today" bottle appears at its random spot.
  const bottles: SailingBottleItem[] =
    phase === 'sailing'
      ? [...OLD_SAILING, { id: 'today', day_key: TODAY_KEY }]
      : OLD_SAILING

  return (
    <Provider store={store}>
      <SailingSea bottles={bottles} />

      <div className="relative z-10 w-full min-h-[520px] flex flex-col items-center">
        <AnimatePresence>
          {showCompose && (
            <motion.div
              key="compose"
              className="w-full flex flex-col items-center"
              initial={false}
              // No exit fade — the landed bottle stays put; the drift bottle
              // beneath is revealed instantly when this unmounts.
              exit={{ opacity: 1, transition: { duration: 0 } }}
            >
              <motion.div
                className="text-center"
                animate={{ opacity: phase === 'dropping' ? 0 : 1 }}
                transition={{ duration: 0.3 }}
              >
                <p className="font-display text-xl text-sand">Your bottle awaits</p>
              </motion.div>
              <div className="relative w-[94%] max-w-[420px] mt-6">
                <motion.div
                  animate={{ opacity: phase === 'dropping' ? 0 : 1 }}
                  transition={{ duration: 0.3 }}
                >
                  <MessageEditor
                    key={cycle}
                    onReady={() => undefined}
                    dropping={phase === 'dropping'}
                    onDropComplete={handleComplete}
                  />
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-10 text-center">
          <p className="font-ui text-sm text-sand/60">
            {phase === 'dropping'
              ? 'Casting into the ocean…'
              : phase === 'sailing'
                ? 'Drifting…'
                : 'Bottle waiting…'}
          </p>
        </div>
      </div>
    </Provider>
  )
}

// Sailing panel: multiple floating bottles + the persistent delivery toast.
// "Simulate a delivery" removes a random bottle (mirrors the real refetch that
// drops the matched bottle) and fires the delivered banner.

// 21 bottles — the Still Sailing cap (status route limits to 21).
const INITIAL_SAILING: SailingBottleItem[] = Array.from({ length: 21 }, (_, i) => ({
  id: `s${i + 1}`,
  day_key: new Date(Date.now() - i * 2 * 86_400_000).toISOString().slice(0, 10),
}))

function SailingControls({
  onDeliver,
  count,
}: {
  onDeliver: () => void
  count: number
}) {
  return (
    <button
      disabled={count === 0}
      onClick={onDeliver}
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
  const [showDelivered, setShowDelivered] = useState(false)

  const deliverOne = useCallback(() => {
    setBottles((prev) => {
      if (prev.length === 0) return prev
      const i = Math.floor(Math.random() * prev.length)
      return prev.filter((_, idx) => idx !== i)
    })
    setShowDelivered(true)
  }, [])

  return (
    <Provider store={store}>
      {/* Persistent toast — lives on the sailing screen until dismissed */}
      <DeliveredBannerDynamic
        previewVisible={showDelivered}
        onPreviewDismiss={() => setShowDelivered(false)}
      />

      {/* Full-viewport sea background — all bottles scatter randomly. */}
      <SailingSea bottles={bottles} />

      {/* Foreground over the sea */}
      <div className="relative z-10 flex flex-col items-center gap-8 text-center w-full pt-2">
        <div className="flex flex-col gap-2">
          {bottles.length >= 21 ? (
            <>
              <p className="font-display text-2xl text-sand">Your sea is full</p>
              <p className="font-ui text-sm text-sand/60 max-w-[260px] mx-auto leading-relaxed">
                21 bottles still drifting. Throw again once one of them finds a
                stranger.
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-2xl text-sand">Still sailing</p>
              <p className="font-ui text-sm text-sand/60 max-w-[260px] mx-auto leading-relaxed">
                {bottles.length} bottle{bottles.length === 1 ? '' : 's'} drifting
                through the ocean, waiting to be found.
              </p>
            </>
          )}
        </div>

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

function ReceivedBannerPanel() {
  const [store] = useState(() => makeMockStore({ sendStatus: 'idle' }))
  const [show, setShow] = useState(false)
  return (
    <Provider store={store}>
      {/* ReceivedBanner is fixed-position — renders top-right of the viewport */}
      <ReceivedBannerDynamic
        previewVisible={show}
        onPreviewDismiss={() => setShow(false)}
      />
      <div className="flex flex-col items-center gap-6 text-center pt-16 px-4">
        <div className="flex flex-col gap-1">
          <p className="font-display text-xl text-sand">Received toast</p>
          <p className="font-ui text-sm text-sand/50 max-w-[260px] leading-relaxed">
            Shows while an unread bottle waits in your inbox. Persists until
            read or dismissed. Tap to go to inbox (real nav).
          </p>
        </div>
        <button
          onClick={() => setShow(true)}
          className="px-8 py-3.5 rounded-2xl bg-seafoam text-ocean-deep font-ui
                     font-semibold text-sm tracking-wide transition-all duration-150
                     active:scale-[0.97] hover:brightness-110"
        >
          Trigger banner
        </button>
      </div>
    </Provider>
  )
}

// ─── Panel registry ──────────────────────────────────────────────────────────

const PANELS: Record<PanelId, React.FC> = {
  'idle': IdlePanel,
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
          {/* Opacity-only transition: a `y`/transform here would become the
              containing block for the sailing panel's fixed sea, boxing it. */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activePanel}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
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
