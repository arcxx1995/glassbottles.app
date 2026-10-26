'use client'

import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { Anchor, Mail, Sailboat, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetReceivedBottlesQuery } from '@/store/api/bottleApi'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { springFlick, springMove } from '@/components/ui/springs'


export default function BottomNav() {
  const pathname = usePathname()
  const user = useAppSelector(selectUser)

  // Unread count for inbox badge. Realtime is the primary signal
  // (RealtimeBottleListener invalidates this cache on delivery) — polling is
  // only a slow safety net, and hidden tabs don't poll at all.
  const { data: bottles } = useGetReceivedBottlesQuery(undefined, {
    skip: !user?.id,
    // eslint-disable-next-line no-restricted-syntax -- polls a Supabase RPC (queryFn), not a Vercel /api route
    pollingInterval: 5 * 60_000,
    skipPollingIfUnfocused: true,
  })
  const unreadCount = bottles?.filter((b) => !b.is_read).length ?? 0
  const NAV_ITEMS = [
    { href: '/sea', label: 'Sea', Icon: Anchor, badge: 0 },
    // The Harbour is Keepers-only (056); hidden while Keeper is off.
    ...(process.env.NEXT_PUBLIC_KEEPER === 'on'
      ? [{ href: '/harbour', label: 'Harbour', Icon: Sailboat, badge: 0 } as const]
      : []),
    { href: '/inbox', label: 'Inbox', Icon: Mail, badge: unreadCount },
    { href: '/settings', label: 'Settings', Icon: Settings, badge: 0 },
  ] as const

  return (
    <nav
      className="print:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pb-safe"
      // Own layer in route transitions: the bar stays put while pages cross-fade.
      style={{ viewTransitionName: 'bottom-nav' }}
      aria-label="Main navigation"
    >
      <div className="glass-strong flex items-center justify-around max-w-md mx-auto h-16 px-2 mb-2 rounded-full">
        {NAV_ITEMS.map(({ href, label, Icon, badge }) => {
          const isActive =
            pathname === href || pathname.startsWith(href + '/')
          const showBadge = badge > 0

          return (
            <TransitionLink
              key={href}
              href={href}
              className={cn(
                'press relative flex flex-col items-center gap-1 flex-1 py-2 rounded-full transition-[color,background-color,border-color,transform] duration-200',
                isActive ? 'text-seafoam' : 'text-sand/40 hover:text-sand/70'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              {/* One pill, handed between tabs: it slides from where it was. */}
              {isActive && (
                <motion.span
                  layoutId="nav-pill"
                  transition={springMove}
                  className="absolute inset-0 rounded-full bg-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                  aria-hidden="true"
                />
              )}
              <span className="relative inline-flex">
                <Icon size={22} strokeWidth={isActive ? 1.75 : 1.5} aria-hidden="true" />
                <AnimatePresence>
                  {showBadge && (
                    <motion.span
                      key="badge"
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={springFlick}
                      className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full
                                 bg-coral text-ocean-deep font-ui font-semibold text-[9px]
                                 flex items-center justify-center px-[3px]"
                      aria-label={`${badge} unread`}
                    >
                      {badge > 9 ? '9+' : badge}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span className="relative font-ui text-[10px] font-medium tracking-wide">
                {label}
              </span>
            </TransitionLink>
          )
        })}
      </div>
    </nav>
  )
}
