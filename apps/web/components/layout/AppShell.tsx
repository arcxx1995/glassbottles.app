'use client'

import { usePathname } from 'next/navigation'
import { useViewTransitionSettle } from '@/components/ui/TransitionLink'
import WaveBackground from '@/components/shared/WaveBackground'
import BottomNav from './BottomNav'

export default function AppShell({
  children,
}: {
  children: React.ReactNode
}) {
  const path = usePathname()
  useViewTransitionSettle()
  // The Sea and the Harbour paint their own full-screen water.
  const ownWater = path === '/sea' || path === '/harbour' || path.startsWith('/harbour/')
  return (
    <div className="relative h-[100svh] overflow-hidden print:h-auto print:overflow-visible">
      {/* A second ocean under theirs was invisible but still animating. */}
      {!ownWater && <div className="print:hidden"><WaveBackground /></div>}
      <main className="relative z-10 h-app-main overflow-hidden pt-safe print:h-auto print:overflow-visible">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
