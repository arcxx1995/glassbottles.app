import dynamic from 'next/dynamic'
import AppShell from '@/components/layout/AppShell'

// Client-only — Supabase Realtime + Redux dispatch
const RealtimeBottleListener = dynamic(
  () => import('@/components/shared/RealtimeBottleListener'),
  { ssr: false }
)

// Client-only — reads Redux banner state, no SSR needed
const ReceivedBanner = dynamic(
  () => import('@/components/shared/ReceivedBanner'),
  { ssr: false }
)

// Client-only — persistent "your bottle was delivered" toast
const DeliveredBanner = dynamic(
  () => import('@/components/shared/DeliveredBanner'),
  { ssr: false }
)

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <RealtimeBottleListener />
      {/* One stack for both toasts, so they never overlap each other — and
          above the bottom nav, clear of the throwable bottle pinned top-right. */}
      <div
        className="pointer-events-none fixed right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }}
      >
        <ReceivedBanner />
        <DeliveredBanner />
      </div>
      {children}
    </AppShell>
  )
}
