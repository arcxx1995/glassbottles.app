import dynamic from 'next/dynamic'
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
  return (
    <div className="relative min-h-screen">
      <WaveBackground />
      <main className="relative z-10 min-h-screen pb-20">{children}</main>
      <BottomNav />
    </div>
  )
}
