'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useSpotWhaleMutation } from '@/store/api/bottleApi'
import { feel } from '@/lib/feel'

// Moby Dick (migration 058): surfaces on your sea for 90 minutes, one day a
// week, at a local hour drawn from the date. Tap it to spot it, once a day,
// for one more on your lifetime count. No push, no countdown — it's there if
// you happen to look.

/** Re-render when the window opens or closes, without polling anything. */
function useInWindow(start?: string, end?: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!start || !end) return
    const next = [new Date(start).getTime(), new Date(end).getTime()].find((t) => t > now)
    if (!next) return
    const t = setTimeout(() => setNow(Date.now()), Math.min(next - now + 500, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [start, end, now])
  return !!start && !!end && now >= new Date(start).getTime() && now <= new Date(end).getTime()
}

export default function Whale({ whale }: { whale?: { start: string; end: string; spotted: boolean } | null }) {
  const reduced = useReducedMotion() ?? false
  const surfaced = useInWindow(whale?.start, whale?.end)
  const [spot, { isLoading }] = useSpotWhaleMutation()
  const [sighting, setSighting] = useState(0)
  useEffect(() => {
    if (!sighting) return
    const t = setTimeout(() => setSighting(0), 3500)
    return () => clearTimeout(t)
  }, [sighting])

  const visible = surfaced && whale && !whale.spotted

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.button
            key="whale"
            type="button"
            aria-label="Moby Dick surfaced — tap to spot it"
            disabled={isLoading}
            onClick={() => {
              feel('splash')
              void spot()
                .unwrap()
                .then(setSighting)
            }}
            initial={{ opacity: 0, y: 24 }}
            animate={reduced ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, -4, 0] }}
            exit={{ opacity: 0, y: 30, transition: { duration: 1.2 } }}
            transition={reduced ? { duration: 0.6 } : { duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            // Deep water just above the nav: right on phones (clear of the
            // footer copy), left on wider screens (clear of the toast stack).
            className="fixed z-20 right-[4%] sm:right-auto sm:left-[6%] p-2"
            style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }}
          >
            <svg width="64" height="34" viewBox="0 0 84 44" fill="none" aria-hidden>
              {/* spout */}
              <path d="M30 10 Q27 3 23 1 M30 10 Q31 2 34 0 M30 10 Q34 4 39 3" stroke="#F2F7F8"
                strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />
              {/* back and tail riding the swell */}
              <path d="M8 34 Q20 14 42 16 Q60 18 66 30 Q70 22 78 18 Q74 28 76 34 Z"
                fill="#E8EEF0" />
              <path d="M14 33 Q24 22 40 22" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="1.5" strokeLinecap="round" />
              {/* old harpoon scars */}
              <path d="M36 25 L44 29 M41 24 L47 27 M52 22 L55 28" stroke="#9FB0B8" strokeWidth="0.9" strokeLinecap="round" />
              <circle cx="22" cy="27" r="1.2" fill="#0A1B28" />
              {/* waterline */}
              <path d="M0 36 Q21 31 42 36 T84 36" stroke="#4ECDC4" strokeOpacity="0.25" strokeWidth="1.5" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sighting > 0 && (
          <motion.p
            role="status"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed z-20 right-[4%] sm:right-auto sm:left-[6%] rounded-xl bg-ocean-deep/90 border border-white/10 px-3 py-2 font-ui text-xs text-sand/80"
            // Above the whale, which is still diving while this shows.
            style={{ bottom: 'calc(8.25rem + env(safe-area-inset-bottom))' }}
          >
            You spotted Moby Dick · Sighting no. {sighting}
          </motion.p>
        )}
      </AnimatePresence>
    </>
  )
}
