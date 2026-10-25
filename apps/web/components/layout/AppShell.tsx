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
  const inSea = path === '/sea'
  return (
    <div className="relative h-[100svh] overflow-hidden print:h-auto print:overflow-visible">
      {/* The Sea paints its own full-screen ocean (SailingSea); a second one
          underneath it was invisible but still animating. */}
      {!inSea && <div className="print:hidden"><WaveBackground /></div>}
      <main className="relative z-10 h-app-main overflow-hidden pt-safe print:h-auto print:overflow-visible">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
