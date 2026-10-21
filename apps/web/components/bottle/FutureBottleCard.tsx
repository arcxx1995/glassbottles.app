'use client'

import { useEffect } from 'react'
import { Hourglass } from 'lucide-react'
import { useGetAtelierQuery, useMarkFutureReadMutation, type FutureBottles } from '@/store/api/bottleApi'
import { WEATHER_LABEL, resolveLook } from '@/lib/dressing'

// A letter to yourself that washed back (migration 047). Your own words, so
// no ripple, no report — just the note, on the paper you chose then.

function ago(iso: string) {
  const months = Math.round((Date.now() - new Date(iso).getTime()) / (30.44 * 864e5))
  if (months >= 12) return `${Math.round(months / 12)} year${months >= 18 ? 's' : ''} ago`
  if (months >= 1) return `${months} month${months === 1 ? '' : 's'} ago`
  return 'recently'
}

export default function FutureBottleCard({ bottle }: { bottle: FutureBottles['arrived'][number] }) {
  const { data: pieces } = useGetAtelierQuery()
  const [markRead] = useMarkFutureReadMutation()
  const look = resolveLook(bottle.style, pieces)

  useEffect(() => {
    if (!bottle.read_at) void markRead(bottle.id)
  }, [bottle.id, bottle.read_at, markRead])

  return (
    <article
      className="relative rounded-card border border-seafoam/20 p-6 mx-4 shadow-card"
      style={{ background: look.paper }}
    >
      <p className="mb-3 flex items-center gap-1.5 font-ui text-[11px] uppercase tracking-widest text-seafoam/70">
        <Hourglass size={12} strokeWidth={1.5} />
        From you · written {ago(bottle.created_at)}
        {bottle.weather && ` · ${WEATHER_LABEL[bottle.weather]} sky`}
      </p>
      <p className="font-display text-lg leading-relaxed whitespace-pre-line" style={{ color: look.ink }}>
        {bottle.message}
      </p>
    </article>
  )
}
