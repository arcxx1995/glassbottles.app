'use client'

import { usePathname } from 'next/navigation'
import { TransitionLink, useViewTransitionSettle } from '@/components/ui/TransitionLink'
import { ChevronLeft } from 'lucide-react'
import WaveBackground from '@/components/shared/WaveBackground'
import BottomNav from './BottomNav'
import FeedShell from './FeedShell'

// Routes that live in the 3-panel social shell.
const SOCIAL = /^\/(feed|u\/|c\/|friends|communities)/

export default function AppShell({
  children,
}: {
  children: React.ReactNode
}) {
  const path = usePathname()
  useViewTransitionSettle()
  const inSea = path === '/sea'
  const social = SOCIAL.test(path)
  return (
    <div className="relative h-[100svh] overflow-hidden print:h-auto print:overflow-visible">
      {/* The Sea paints its own full-screen ocean (SailingSea); a second one
          underneath it was invisible but still animating. */}
      {!inSea && <div className="print:hidden"><WaveBackground /></div>}
      {inSea && (
        // The Sea is an app within the app: a way back to the feed, nothing else.
        <TransitionLink
          href="/feed"
          className="press glass vibrant fixed left-4 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 inline-flex h-9 items-center gap-1 rounded-full pl-2 pr-4 font-ui text-xs text-sand/85 print:hidden"
        >
          <ChevronLeft size={16} aria-hidden="true" /> Feed
        </TransitionLink>
      )}
      <main className={`relative z-10 h-app-main overflow-hidden pt-safe print:h-auto print:overflow-visible ${social ? 'lg:h-[100svh]' : ''}`}>
        {social ? <FeedShell>{children}</FeedShell> : children}
      </main>
      {/* The left panel carries the nav on desktop social pages. */}
      <div className={social ? 'lg:hidden' : undefined}><BottomNav /></div>
    </div>
  )
}
