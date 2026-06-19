'use client'

import dynamic from 'next/dynamic'
import BottomNav from './BottomNav'

const WaveBackground = dynamic(
  () => import('@/components/shared/WaveBackground'),
  { ssr: false }
)

// Every app route is pinned to the viewport (100svh, no page scroll) with the
// nav reserved at the bottom (4rem). Pages own their internal scrolling — a long
// inbox list scrolls inside its region, the page frame and nav never move.
export default function AppShell({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative h-[100svh] overflow-hidden">
      <WaveBackground />
      <main className="relative z-10 h-app-main overflow-hidden pt-safe">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
