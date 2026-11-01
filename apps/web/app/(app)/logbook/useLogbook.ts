'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CurrentId, Weather } from '@/lib/dressing'

// One read per visit (migration 048) — the Logbook is history, not live.

interface Common {
  message: string
  at: string
  weather: Weather | null
}
export interface Logbook {
  sent: (Common & { found: boolean; rippled: boolean; current: CurrentId | null })[]
  received: (Common & { kept: boolean; current: CurrentId | null })[]
  future: (Common & { written: string })[]
}

export function useLogbook() {
  const [data, setData] = useState<Logbook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setLoading] = useState(true)
  useEffect(() => {
    void createClient()
      .rpc('get_logbook')
      .then(({ data, error }) => {
        if (error) setError(error.message.includes('keeper_only') ? 'keeper_only' : 'failed')
        else setData(data as Logbook)
        setLoading(false)
      })
  }, [])
  return { data, error, isLoading }
}
