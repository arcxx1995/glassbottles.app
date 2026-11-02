'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/lib/signOut'
import { cn } from '@/lib/utils'
import { rpc } from './shared'

const TABS = [
  { href: '/vvs', label: 'Reports & blocks', count: 'open' },
  { href: '/vvs/ai-holds', label: 'AI holds', count: 'ai' },
  { href: '/vvs/people', label: 'People' },
  { href: '/vvs/log', label: 'Log' },
] as const

type Counts = { open: number; urgent: number; ai: number }

// Loads once per tab change. No polling: the alert emails say when to come back.
export default function VvsNav() {
  const path = usePathname()
  const [counts, setCounts] = useState<Counts | null>(null)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    void rpc<Counts>('admin_counts').then(setCounts).catch(() => setCounts(null))
  }, [path])

  return (
    <header className="sticky top-0 z-10 border-b border-border-subtle bg-ocean-mid/95 backdrop-blur">
      {/* On a phone the tabs take their own row and scroll, so Log out stays in view. */}
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-1 gap-y-1 px-4 py-2.5">
        <span className="order-1 mr-2 font-display text-lg">vvs</span>
        <nav aria-label="Console" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-2 sm:w-auto">
          {TABS.map((t) => {
            const active = t.href === '/vvs' ? path === '/vvs' : path.startsWith(t.href)
            const n = 'count' in t ? counts?.[t.count] : undefined
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 font-ui text-xs font-medium',
                  active ? 'bg-white/10 text-sand' : 'text-sand/55 hover:text-sand',
                )}
              >
                {t.label}
                {!!n && (
                  <span
                    className={cn(
                      'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]',
                      t.href === '/vvs' && counts?.urgent ? 'bg-coral text-ocean-deep' : 'bg-white/10 text-sand/80',
                    )}
                  >
                    {n}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
        <button
          type="button"
          disabled={leaving}
          onClick={() => {
            setLeaving(true)
            // A full load, so the next page is decided with the session gone.
            void signOut(() => window.location.assign('/vvs/login'))
          }}
          className="press order-2 ml-auto whitespace-nowrap rounded-full bg-white/5 px-3 py-1.5 font-ui text-xs font-medium text-sand/75 hover:text-sand disabled:opacity-50 sm:order-3"
        >
          {leaving ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </header>
  )
}
