'use client'

import { TransitionLink as Link } from '@/components/ui/TransitionLink'
import { usePathname } from 'next/navigation'
import { Anchor, BookOpen, Home, Mail, Settings, Users, UsersRound } from 'lucide-react'
import { motion } from 'motion/react'
import { Avatar } from '@/components/ui/Avatar'
import { springMove } from '@/components/ui/springs'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { useGetMyCommunitiesQuery } from '@/store/api/socialApi'
import { useMe } from './useMe'

const NAV = [
  { href: '/feed', label: 'Feed', Icon: Home },
  { href: '/sea', label: 'The Sea', Icon: Anchor },
  { href: '/friends', label: 'Friends', Icon: Users },
  { href: '/communities', label: 'Communities', Icon: UsersRound },
  { href: '/inbox', label: 'Inbox', Icon: Mail },
  { href: '/logbook', label: 'Logbook', Icon: BookOpen },
  { href: '/settings', label: 'Settings', Icon: Settings },
] as const

export default function LeftPanel() {
  const path = usePathname()
  const { uid, me, pendingIn } = useMe()
  const { data: joined = [] } = useGetMyCommunitiesQuery(uid ?? '', { skip: !uid })

  return (
    <div className="flex flex-col gap-4 pb-8">
      {me && (
        <Link href={`/u/${me.handle}`} className="press block rounded-3xl">
          <Card className="flex items-center gap-3 p-4 transition-[border-color] hover:border-white/20">
            <Avatar handle={me.handle} src={me.avatar_url} size={44} />
            <div className="min-w-0 font-ui">
              <p className="truncate text-sm font-semibold text-sand">@{me.handle}</p>
              <p className="text-xs text-sand/50">View profile</p>
            </div>
          </Card>
        </Link>
      )}
      <Card className="p-2">
        <nav aria-label="Social navigation" className="flex flex-col">
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}
              className={cn('press relative flex items-center gap-3 rounded-2xl px-3 py-2.5 font-ui text-sm transition-[color,background-color,transform]',
                path === href ? 'text-seafoam' : 'text-sand/70 hover:bg-white/5 hover:text-sand')}>
              {/* Same sliding highlight as the bottom nav. */}
              {path === href && (
                <motion.span layoutId="side-nav-pill" transition={springMove} aria-hidden="true"
                  className="absolute inset-0 rounded-2xl bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]" />
              )}
              <Icon size={18} aria-hidden="true" className="relative" /> <span className="relative">{label}</span>
              {href === '/friends' && pendingIn > 0 && (
                <span className="relative ml-auto rounded-full bg-coral px-1.5 font-ui text-[10px] font-semibold text-ocean-deep"
                  aria-label={`${pendingIn} friend requests`}>{pendingIn}</span>
              )}
            </Link>
          ))}
        </nav>
      </Card>
      {joined.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-ui text-xs font-semibold uppercase tracking-wider text-sand/40">My communities</h2>
          <ul className="flex flex-col gap-1">
            {joined.map((c) => (
              <li key={c.id}><Link href={`/c/${c.slug}`} className="press block truncate rounded-xl px-2 py-1.5 font-ui text-sm text-sand/70 hover:bg-white/5 hover:text-sand transition-[color,background-color,transform]">c/{c.slug}</Link></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
