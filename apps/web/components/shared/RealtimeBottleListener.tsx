'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { bottleApi } from '@/store/api/bottleApi'
import { setShowReceivedBanner } from '@/store/uiSlice'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * RealtimeBottleListener
 *
 * Mounts once in the app layout. Subscribes to UPDATE events on the `bottles`
 * table filtered to the current user's receiver_id. When the edge function
 * assigns the user as a receiver, we invalidate RTK Query cache tags so the
 * inbox and status queries refetch automatically.
 *
 * Returns null — no UI.
 */
export default function RealtimeBottleListener() {
  const dispatch = useAppDispatch()
  const user = useAppSelector(selectUser)
  // Stable ref — avoids recreating the Supabase client on every render
  const supabaseRef = useRef<SupabaseClient>(createClient())

  useEffect(() => {
    if (!user?.id) return

    const supabase = supabaseRef.current
    const channelName = `bottles:receiver:${user.id}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bottles',
          filter: `receiver_id=eq.${user.id}`,
        },
        () => {
          // Bottle matched to this user — refresh inbox + status
          dispatch(
            bottleApi.util.invalidateTags(['BottleStatus', 'ReceivedBottles'])
          )
          // Show in-app toast banner
          dispatch(setShowReceivedBanner(true))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, dispatch])

  return null
}
