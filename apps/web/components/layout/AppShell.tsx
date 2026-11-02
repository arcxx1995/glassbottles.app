'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { useViewTransitionSettle } from '@/components/ui/TransitionLink'
import WaveBackground from '@/components/shared/WaveBackground'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetKeeperQuery } from '@/store/api/bottleApi'
import BottomNav from './BottomNav'
import AccountNotices from '@/components/shared/AccountNotices'

export const CURRENT_KEY = 'gb:current'
const KEEPER_ON = process.env.NEXT_PUBLIC_KEEPER === 'on'

// A Keeper's current recolours the whole app: globals.css swaps the accent and
// ocean tokens under <html data-current>. Mirrored to localStorage so the
// inline script in (app)/layout.tsx paints it before hydration (no flash).
function useCurrentTheme() {
  const user = useAppSelector(selectUser)
  const { data: keeper } = useGetKeeperQuery(undefined, { skip: !KEEPER_ON || !user?.id })
  // Until the membership loads, keep what the inline script painted.
  const known = !user || !KEEPER_ON || keeper !== undefined
  const current = keeper?.isKeeper ? user?.current ?? null : null
  useEffect(() => {
    if (!known) return
    const root = document.documentElement
    if (current) root.dataset.current = current
    else delete root.dataset.current
    try {
      if (current) localStorage.setItem(CURRENT_KEY, current)
      else localStorage.removeItem(CURRENT_KEY)
    } catch {
      /* blocked storage: the theme still applies, it just loads teal first */
    }
  }, [known, current])
  // Leaving the app (landing, auth) goes back to the default palette.
  useEffect(() => () => void delete document.documentElement.dataset.current, [])
}

// Pages put extras beside the wordmark (the Sea's tides, current) via
// <HeaderSlot>, so the wordmark itself never moves between tabs.
const SlotContext = createContext<HTMLElement | null>(null)
export function HeaderSlot({ children }: { children: React.ReactNode }) {
  const slot = useContext(SlotContext)
  return slot ? createPortal(children, slot) : null
}

export default function AppShell({
  children,
}: {
  children: React.ReactNode
}) {
  const path = usePathname()
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useViewTransitionSettle()
  useCurrentTheme()
  // The Sea and the Harbour paint their own full-screen water.
  const ownWater = path === '/sea' || path === '/harbour' || path.startsWith('/harbour/')
  return (
    <SlotContext.Provider value={slot}>
      <div className="relative h-[100svh] overflow-hidden print:h-auto print:overflow-visible">
        {/* Paints the stored current before anything below it, so a reload
            doesn't flash teal first. Runs once, from the server HTML. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var c=localStorage.getItem('${CURRENT_KEY}');if(c)document.documentElement.dataset.current=c}catch(e){}`,
          }}
        />
        {/* A second ocean under theirs was invisible but still animating. */}
        {!ownWater && <div className="print:hidden"><WaveBackground /></div>}
        {/* The wordmark, in the same place on every page; pages start below
            it with pt-14. Own layer in route transitions, like the nav. */}
        <header
          className="print:hidden pointer-events-none fixed inset-x-0 top-0 z-40 pt-safe"
          style={{ viewTransitionName: 'app-header' }}
        >
          <div className="flex h-14 items-center gap-2.5 px-5">
            <p className="shrink-0 font-display text-2xl tracking-tight text-sand">glassbottles</p>
            <div ref={setSlot} className="flex min-w-0 flex-1 items-center justify-between gap-2" />
          </div>
        </header>
        <main className="relative z-10 h-app-main overflow-hidden pt-safe print:h-auto print:overflow-visible">
          {children}
        </main>
        <AccountNotices />
        <BottomNav />
      </div>
    </SlotContext.Provider>
  )
}
