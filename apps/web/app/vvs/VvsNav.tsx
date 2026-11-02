'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
  useEffect(() => {
    void rpc<Counts>('admin_counts').then(setCounts).catch(() => setCounts(null))
  }, [path])

  return (
    <header className="sticky top-0 z-10 border-b border-border-subtle bg-ocean-mid/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-1 overflow-x-auto px-4 py-2.5">
        <span className="mr-2 font-display text-lg">vvs</span>
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
      </div>
    </header>
  )
}
