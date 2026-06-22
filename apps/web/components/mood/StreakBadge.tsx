'use client'

import { motion } from 'framer-motion'
import { Flame } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetMoodStreakQuery } from '@/store/api/bottleApi'
import { cn } from '@/lib/utils'

/**
 * StreakBadge
 *
 * Compact chip for the home header showing the current mood-check-in streak.
 * Renders nothing until there's a streak worth showing (>0). When the streak is
 * "at risk" (live, not yet checked in today) it warms toward coral as a *gentle*
 * nudge — never a punishing countdown. Reads the same getMoodStreak cache the
 * check-in card writes, so it updates the instant the user checks in.
 */
export default function StreakBadge() {
  const user = useAppSelector(selectUser)
  const { data } = useGetMoodStreakQuery(undefined, { skip: !user?.id })

  const streak = data?.current_streak ?? 0
  if (streak < 1) return null

  const atRisk = data?.at_risk ?? false

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-xs',
        atRisk
          ? 'bg-coral/10 text-coral/90'
          : 'bg-seafoam/10 text-seafoam'
      )}
      title={
        atRisk
          ? 'Check in today to keep your streak warm'
          : `${streak}-day streak`
      }
    >
      <Flame size={12} strokeWidth={2} aria-hidden="true" />
      {streak}
    </motion.span>
  )
}
