'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'
import { Anchor, MessageCircle, Bookmark, Settings, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetReceivedBottlesQuery, useGetThreadsQuery } from '@/store/api/bottleApi'

const NAV_ITEMS: { href: Route; label: string; Icon: LucideIcon }[] = [
  { href: '/home', label: 'Bottle', Icon: Anchor },
  { href: '/threads', label: 'Threads', Icon: MessageCircle },
  { href: '/shelf', label: 'Shelf', Icon: Bookmark },
  { href: '/settings', label: 'Settings', Icon: Settings },
]

export default function BottomNav() {
  const pathname = usePathname()
  const user = useAppSelector(selectUser)

  // Unread count for shelf badge. Realtime is the primary signal
  // (RealtimeBottleListener invalidates this cache on delivery) — polling is
  // only a slow safety net, and hidden tabs don't poll at all.
  const { data: bottles } = useGetReceivedBottlesQuery(undefined, {
    skip: !user?.id,
    // eslint-disable-next-line no-restricted-syntax -- polls a Supabase RPC (queryFn), not a Vercel /api route
    pollingInterval: 5 * 60_000,
    skipPollingIfUnfocused: true,
  })
  const unreadCount = bottles?.filter((b) => !b.is_read).length ?? 0

  const { data: threads } = useGetThreadsQuery(undefined, {
    skip: !user?.id,
    // eslint-disable-next-line no-restricted-syntax -- polls a Supabase RPC (queryFn), not a Vercel /api route
    pollingInterval: 30_000,
    skipPollingIfUnfocused: true,
  })
  const threadBadge =
    (threads?.filter((t) => t.status === 'pending' && t.role === 'recipient').length ?? 0) +
    (threads?.filter((t) => t.status === 'active' && t.unread_count > 0).length ?? 0)

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-ocean-mid/80 backdrop-blur-md border-t border-white/5 pb-safe"
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-around max-w-md mx-auto h-16 px-2">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(href + '/')
          const badgeCount =
            href === '/shelf' ? unreadCount :
            href === '/threads' ? threadBadge : 0
          const showBadge = badgeCount > 0

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex flex-col items-center gap-1 flex-1 py-2 rounded-xl transition-colors duration-200',
                isActive
                  ? 'text-seafoam'
                  : 'text-sand/30 hover:text-sand/60'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="relative inline-flex">
                <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
                {showBadge && (
                  <span
                    className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full
                               bg-coral text-ocean-deep font-ui font-semibold text-[9px]
                               flex items-center justify-center px-[3px]"
                    aria-label={`${badgeCount} unread`}
                  >
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </span>
              <span className="font-ui text-[10px] font-medium tracking-wide">
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
