'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import Toast from '@/components/ui/Toast'
import { Sparkles, X } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetTodayBottleStatusQuery, useAckRipplesMutation } from '@/store/api/bottleApi'
import { feel } from '@/lib/feel'

/**
 * RippleBanner — a stranger tapped "this reached me" on one of your bottles
 * (migration 044). Like DeliveredBanner, visibility derives from server state
 * (status.ripples: rippled, not yet acked), so reloads and other devices agree,
 * and dismissing persists through ack_ripples. Rendered once in (app)/layout.
 */
export default function RippleBanner() {
  const user = useAppSelector(selectUser)
  // Shares the status cache; DeliveredBanner's slow poll keeps it fresh.
  const { data: status } = useGetTodayBottleStatusQuery(undefined, { skip: !user?.id })
  const [ack] = useAckRipplesMutation()
  const ripples = status?.ripples ?? []
  const visible = ripples.length > 0

  const newest = ripples[0]?.id
  const chimed = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!visible || !newest || chimed.current === newest) return
    chimed.current = newest
    feel('chime')
  }, [visible, newest])

  return (
    <AnimatePresence>
      {visible && (
        <Toast
          key="ripple-banner"
          onDismiss={() => void ack()}
          className="pointer-events-auto w-full flex items-center gap-3 overflow-hidden
                     glass-strong border-seafoam/25 rounded-3xl px-4 py-3.5 shadow-banner text-left"
          role="status"
          aria-live="polite"
        >
          <span className="shrink-0 text-seafoam" aria-hidden>
            <Sparkles size={22} strokeWidth={1.5} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-ui text-sm font-medium text-sand leading-snug">
              Your bottle reached someone
            </p>
            <p className="font-ui text-xs text-sand/45 mt-0.5">
              {ripples.length > 1
                ? `${ripples.length} strangers let you know your words landed.`
                : 'A stranger let you know your words landed.'}
            </p>
          </div>
          <button
            onClick={() => void ack()}
            aria-label="Dismiss"
            className="press shrink-0 -my-2 -mr-3 flex h-11 w-11 items-center justify-center rounded-full text-sand/50 hover:text-sand hover:bg-white/5 transition-[color,background-color,transform]"
          >
            <X size={16} />
          </button>
        </Toast>
      )}
    </AnimatePresence>
  )
}
