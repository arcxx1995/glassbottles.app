'use client'

import { usePathname } from 'next/navigation'
import WaveBackground from '@/components/shared/WaveBackground'
import BottomNav from './BottomNav'

export default function AppShell({
  children,
}: {
  children: React.ReactNode
}) {
  const onHome = usePathname() === '/home'
  return (
    <div className="relative h-[100svh] overflow-hidden print:h-auto print:overflow-visible">
      {/* /home paints its own full-screen sea (SailingSea); a second ocean
          underneath it was invisible but still animating. */}
      {!onHome && <div className="print:hidden"><WaveBackground /></div>}
      <main className="relative z-10 h-app-main overflow-hidden pt-safe print:h-auto print:overflow-visible">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
