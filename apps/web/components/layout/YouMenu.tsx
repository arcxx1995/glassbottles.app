'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { Compass, LogOut, Sailboat, Settings, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/signOut'
import { CURRENT_INFO } from '@/lib/dressing'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetHarbourQuery } from '@/store/api/bottleApi'
import { spring, springMove } from '@/components/ui/springs'
import KayakEditor from '@/components/harbour/KayakEditor'
import CurrentSheet from '@/components/shared/CurrentSheet'

const KEEPER_ON = process.env.NEXT_PUBLIC_KEEPER === 'on'

// The nav's last tab: a small menu rising from it — your handle, your kayak,
// your current, Settings, and log out.
export default function YouMenu() {
  const pathname = usePathname()
  const router = useRouter()
  const user = useAppSelector(selectUser)
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(false)
  const [sheet, setSheet] = useState<null | 'kayak' | 'current'>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const firstItem = useRef<HTMLButtonElement>(null)

  // The handle and kayak come from the Harbour read (056); fetched the first
  // time the menu opens, not on every page.
  const { data: harbour, isFetching } = useGetHarbourQuery(undefined, { skip: !KEEPER_ON || !opened || !user?.id })
  const mine = harbour?.mine ?? null

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    firstItem.current?.focus()
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = open || pathname === '/settings' || pathname.startsWith('/settings/')
  const pick = (run: () => void) => () => {
    setOpen(false)
    run()
  }
  const current = user?.current ? CURRENT_INFO[user.current].name : 'Open sea'

  const item =
    'press flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left font-ui text-sm text-sand/85 transition-[background-color,transform] hover:bg-white/[0.06] focus-visible:bg-white/[0.08] focus-visible:outline-none'

  return (
    <div ref={wrap} className="relative flex flex-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpened(true)
          setOpen((v) => !v)
        }}
        className={cn(
          'press relative flex flex-1 flex-col items-center gap-1 rounded-full py-2 transition-[color,transform] duration-200',
          active ? 'text-seafoam' : 'text-sand/40 hover:text-sand/70',
        )}
      >
        {active && (
          <motion.span
            layoutId="nav-pill"
            transition={springMove}
            className="absolute inset-0 rounded-full bg-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
            aria-hidden="true"
          />
        )}
        <UserRound size={22} strokeWidth={active ? 1.75 : 1.5} className="relative" aria-hidden="true" />
        <span className="relative font-ui text-[10px] font-medium tracking-wide">You</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="You"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={spring}
            style={{ transformOrigin: 'bottom right' }}
            // Near-opaque, not glass: a backdrop blur nested in the nav's own
            // blur sees nothing behind it, so the page showed through.
            className="absolute bottom-[calc(100%+0.9rem)] right-0 w-60 rounded-3xl border border-white/10 bg-[#0E2238]/[0.97] p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
          >
            {KEEPER_ON && (
              <p className="truncate px-3 pb-1.5 pt-2 font-ui text-xs text-sand/50">
                {mine ? `@${mine.handle}` : isFetching && !harbour ? '…' : 'No kayak launched yet'}
              </p>
            )}
            {KEEPER_ON && (
              <button
                ref={firstItem}
                type="button"
                role="menuitem"
                disabled={!harbour}
                className={cn(item, 'disabled:opacity-50')}
                onClick={pick(() => (harbour?.keeper ? setSheet('kayak') : router.push('/harbour')))}
              >
                <Sailboat size={17} strokeWidth={1.5} className="text-seafoam" aria-hidden="true" />
                Your kayak
              </button>
            )}
            <button
              ref={KEEPER_ON ? undefined : firstItem}
              type="button"
              role="menuitem"
              className={item}
              onClick={pick(() => setSheet('current'))}
            >
              <Compass size={17} strokeWidth={1.5} className="text-seafoam" aria-hidden="true" />
              <span className="flex-1">Your current</span>
              <span className="font-ui text-[11px] text-sand/40">{current}</span>
            </button>
            <button type="button" role="menuitem" className={item} onClick={pick(() => router.push('/settings'))}>
              <Settings size={17} strokeWidth={1.5} className="text-sand/60" aria-hidden="true" />
              Settings
            </button>
            <div className="mx-3 my-1 h-px bg-white/[0.08]" />
            <button
              type="button"
              role="menuitem"
              className={cn(item, 'text-coral/90')}
              onClick={pick(() => void signOut((path) => router.replace(path)))}
            >
              <LogOut size={17} strokeWidth={1.5} aria-hidden="true" />
              Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet === 'kayak' && <KayakEditor mine={mine} onClose={() => setSheet(null)} />}
        {sheet === 'current' && <CurrentSheet onClose={() => setSheet(null)} />}
      </AnimatePresence>
    </div>
  )
}
