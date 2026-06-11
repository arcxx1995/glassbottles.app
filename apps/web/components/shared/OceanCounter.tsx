'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetBottleCountQuery } from '@/store/api/bottleApi'

/**
 * OceanCounter
 *
 * Ambient social proof: "X bottles in the ocean today"
 * Shown on the home page below the DailyTimer in the thrown state,
 * and as a subtle footer on the idle state.
 *
 * - Polls every 5 minutes (not critical path — ambient data)
 * - Skips if user not authenticated
 * - No render if count is 0 or data not yet loaded
 */
export default function OceanCounter() {
  const user = useAppSelector(selectUser)

  const { data } = useGetBottleCountQuery(undefined, {
    skip: !user?.id,
    // eslint-disable-next-line no-restricted-syntax -- polls a Supabase RPC (queryFn), not a Vercel /api route
    pollingInterval: 5 * 60 * 1000, // 5 minutes
    skipPollingIfUnfocused: true, // hidden tabs don't poll
  })

  if (!data || data.count === 0) return null

  const label =
    data.count === 1
      ? '1 bottle in the ocean today'
      : `${data.count.toLocaleString()} bottles in the ocean today`

  return (
    <AnimatePresence>
      <motion.p
        key={data.count}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="font-ui text-[11px] text-sand/25 text-center tabular-nums"
        aria-live="polite"
        aria-atomic="true"
      >
        {label}
      </motion.p>
    </AnimatePresence>
  )
}
