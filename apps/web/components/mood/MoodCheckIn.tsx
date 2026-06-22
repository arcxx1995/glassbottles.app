'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sun, Cloud, CloudFog, CloudLightning } from 'lucide-react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetMoodStreakQuery, useCheckInMoodMutation } from '@/store/api/bottleApi'
import type { Mood } from '@/types'
import { cn } from '@/lib/utils'

/** Weather metaphor, ordered calm → stormy. */
const MOODS: { mood: Mood; label: string; Icon: typeof Sun; color: string }[] = [
  { mood: 'sunny', label: 'Sunny', Icon: Sun, color: 'text-sand' },
  { mood: 'calm', label: 'Calm', Icon: Cloud, color: 'text-seafoam' },
  { mood: 'foggy', label: 'Foggy', Icon: CloudFog, color: 'text-sand/60' },
  { mood: 'stormy', label: 'Stormy', Icon: CloudLightning, color: 'text-coral' },
]

const MOOD_BY_KEY = Object.fromEntries(MOODS.map((m) => [m.mood, m])) as Record<
  Mood,
  (typeof MOODS)[number]
>

interface MoodCheckInProps {
  /** Bubbles the chosen (or already-set) mood up so the throw flow can seed a
   *  gentle prompt ("Stormy today? Throw a bottle about it"). */
  onMood?: (mood: Mood | null) => void
}

/**
 * MoodCheckIn
 *
 * The low-bar daily ritual on the home idle screen. One tap on a weather metaphor
 * checks the user in, advances the streak (migration 025) and collapses to a
 * compact "today you're {mood}" line. Re-tapping a different weather updates the
 * mood without re-advancing the streak. Hidden for signed-out users.
 */
export default function MoodCheckIn({ onMood }: MoodCheckInProps) {
  const user = useAppSelector(selectUser)
  const { data } = useGetMoodStreakQuery(undefined, { skip: !user?.id })
  const [checkIn, { isLoading }] = useCheckInMoodMutation()

  const checkedIn = data?.checked_in_today ?? false
  const todayMood = data?.today_mood ?? null

  // Keep the parent's seeded prompt in sync with server/optimistic truth.
  useEffect(() => {
    onMood?.(todayMood)
  }, [todayMood, onMood])

  if (!user?.id) return null

  async function handlePick(mood: Mood) {
    if (isLoading) return
    try {
      await checkIn(mood).unwrap()
    } catch {
      // Optimistic patch self-reverts on failure; the picker stays available.
    }
  }

  return (
    <div className="w-full">
      <AnimatePresence mode="wait" initial={false}>
        {checkedIn && todayMood ? (
          // ── Collapsed: today's weather + a quiet re-pick affordance ──
          <motion.button
            key="checked"
            type="button"
            onClick={() => onMood?.(todayMood)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="mx-auto flex items-center gap-2 rounded-full bg-white/[0.04] px-3.5 py-1.5"
          >
            {(() => {
              const { Icon, color, label } = MOOD_BY_KEY[todayMood]
              return (
                <>
                  <Icon size={15} strokeWidth={1.75} className={color} aria-hidden="true" />
                  <span className="font-ui text-xs text-sand/60">
                    Today you&apos;re feeling {label.toLowerCase()}
                  </span>
                </>
              )
            })()}
          </motion.button>
        ) : (
          // ── Expanded: the four-weather picker ──
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-2.5"
          >
            <p className="font-ui text-xs text-sand/45">How&apos;s your weather today?</p>
            <div className="flex items-center justify-center gap-2">
              {MOODS.map(({ mood, label, Icon, color }) => (
                <button
                  key={mood}
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handlePick(mood)}
                  aria-label={label}
                  className={cn(
                    'flex h-12 w-12 flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03]',
                    'transition-colors duration-200 hover:border-seafoam/25 hover:bg-white/[0.06]',
                    'disabled:opacity-50 disabled:pointer-events-none active:scale-[0.95]'
                  )}
                >
                  <Icon size={20} strokeWidth={1.5} className={color} aria-hidden="true" />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
