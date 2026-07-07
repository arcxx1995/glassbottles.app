'use client'

import { useState, useEffect } from 'react'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'

interface TimeLeft {
  hours: number
  minutes: number
  seconds: number
}

// Counts down to midnight in the QUOTA timezone — the daily reset happens at
// local midnight in profiles.timezone (migration 019), which is what the
// server's user_local_date() uses. The browser tz usually matches (AuthProvider
// syncs it), but a traveller mid-session or a failed sync would otherwise see
// a countdown to the wrong reset moment.
export function getTimeUntilMidnightInTz(tz?: string): TimeLeft {
  let elapsedSec: number | null = null
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }).formatToParts(new Date())
      const get = (t: string) =>
        Number(parts.find((p) => p.type === t)?.value ?? NaN)
      // hour12:false can yield "24" at midnight — normalise.
      const h = get('hour') % 24
      const m = get('minute')
      const s = get('second')
      if ([h, m, s].every(Number.isFinite)) elapsedSec = h * 3600 + m * 60 + s
    } catch {
      /* unknown tz string — fall back to browser-local below */
    }
  }
  if (elapsedSec === null) {
    const now = new Date()
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    elapsedSec = 86400 - Math.floor((midnight.getTime() - now.getTime()) / 1000)
  }
  // ponytail: wall-clock remainder — on the two DST-transition nights a year
  // this is off by the shifted hour until midnight passes; exact-instant math
  // isn't worth it for a decorative countdown.
  const diff = 86400 - elapsedSec
  return {
    hours: Math.floor(diff / 3600),
    minutes: Math.floor((diff % 3600) / 60),
    seconds: diff % 60,
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export default function DailyTimer() {
  const user = useAppSelector(selectUser)
  const tz = user?.timezone
  const [time, setTime] = useState<TimeLeft | null>(null)

  useEffect(() => {
    setTime(getTimeUntilMidnightInTz(tz))
    const interval = setInterval(() => {
      setTime(getTimeUntilMidnightInTz(tz))
    }, 1000)
    return () => clearInterval(interval)
  }, [tz])

  if (!time) return null

  return (
    <div className="flex flex-col items-center gap-1.5">
      <p className="font-ui text-[10px] text-sand/40 uppercase tracking-widest">
        Next bottle in
      </p>
      <p className="font-mono text-2xl text-sand/60 tabular-nums tracking-tight">
        {pad(time.hours)}
        <span className="text-sand/30 mx-0.5">:</span>
        {pad(time.minutes)}
        <span className="text-sand/30 mx-0.5">:</span>
        {pad(time.seconds)}
      </p>
    </div>
  )
}
