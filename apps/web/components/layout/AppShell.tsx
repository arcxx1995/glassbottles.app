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
    <div className="relative h-[100svh] overflow-hidden">
      {/* /home paints its own full-screen sea (SailingSea); a second ocean
          underneath it was invisible but still animating. */}
      {!onHome && <WaveBackground />}
      <main className="relative z-10 h-app-main overflow-hidden pt-safe">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
