'use client'

import { useState, useEffect } from 'react'

interface TimeLeft {
  hours: number
  minutes: number
  seconds: number
}

function getTimeUntilMidnightUTC(): TimeLeft {
  const now = new Date()
  const midnight = new Date()
  midnight.setUTCHours(24, 0, 0, 0)
  const diff = midnight.getTime() - now.getTime()

  return {
    hours: Math.floor(diff / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export default function DailyTimer() {
  const [time, setTime] = useState<TimeLeft | null>(null)

  useEffect(() => {
    setTime(getTimeUntilMidnightUTC())
    const interval = setInterval(() => {
      setTime(getTimeUntilMidnightUTC())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

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
