'use client'

import { motion } from 'motion/react'
import { spring } from '@/components/ui/springs'
import { useAppDispatch } from '@/store'
import { setMessage } from '@/store/bottleSlice'
import { useAckHeldBottleMutation, type HeldBottle } from '@/store/api/bottleApi'

// A bottle the safety screen kept ashore (migration 043). Its words come back
// so the sender can rewrite them; the day's throw is restored once per day.

const WHY: Record<NonNullable<HeldBottle['screen_reason']>, string> = {
  contact: 'Bottles travel without names, and this one seemed to carry contact details or a link.',
  harm: 'It read as unkind toward someone.',
  sexual: 'It had sexual content, which the sea doesn’t carry.',
  spam: 'It read like an ad or a chain message.',
}

export default function HeldNotice({
  held,
  canRethrow,
}: {
  held: HeldBottle
  /** False when the day was already restored once: try again tomorrow. */
  canRethrow: boolean
}) {
  const dispatch = useAppDispatch()
  const [ack] = useAckHeldBottleMutation()

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className="w-full max-w-[420px] rounded-3xl glass-strong px-4 py-3 text-left"
    >
      <p className="font-display text-sm text-sand">Your bottle stayed ashore</p>
      <p className="font-ui text-[11px] text-sand/55 leading-snug mt-0.5">
        {held.screen_reason ? WHY[held.screen_reason] : 'It didn’t pass the safety check.'}{' '}
        {canRethrow ? 'Today’s throw is yours again.' : 'You can throw again tomorrow.'}
      </p>
      <div className="flex items-center gap-1 mt-2 -ml-1">
        {canRethrow && (
          <button
            type="button"
            onClick={() => {
              dispatch(setMessage(held.message))
              void ack(held.id)
            }}
            className="press px-3 py-1.5 rounded-full bg-seafoam/15 text-seafoam font-ui text-xs font-medium hover:bg-seafoam/25 transition-[color,background-color,transform]"
          >
            Rewrite it
          </button>
        )}
        <button
          type="button"
          onClick={() => void ack(held.id)}
          className="press px-3 py-1.5 rounded-xl font-ui text-xs text-sand/50 hover:text-sand/80 transition-[color,background-color,transform]"
        >
          {canRethrow ? 'Let it go' : 'Okay'}
        </button>
      </div>
    </motion.div>
  )
}
