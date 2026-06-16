'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import BottomNav from './BottomNav'

const WaveBackground = dynamic(
  () => import('@/components/shared/WaveBackground'),
  { ssr: false }
)

export default function AppShell({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isHome = pathname === '/home'

  return (
    <div className={isHome ? 'relative h-[100svh] overflow-hidden' : 'relative min-h-screen'}>
      <WaveBackground />
      <main
        className={
          isHome
            ? 'relative z-10 h-[calc(100svh-4rem)] overflow-hidden'
            : 'relative z-10 min-h-screen pb-20'
        }
      >
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
