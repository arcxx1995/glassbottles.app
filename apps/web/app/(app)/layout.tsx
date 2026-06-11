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
      <ReceivedBanner />
      <DeliveredBanner />
      {children}
    </AppShell>
  )
}
