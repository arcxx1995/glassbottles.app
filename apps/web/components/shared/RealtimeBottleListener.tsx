'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { bottleApi } from '@/store/api/bottleApi'
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

/**
 * RealtimeBottleListener
 *
 * Mounts once in the (app) layout. Subscribes to the user's private Broadcast
 * topic `user:<uuid>` — events are sent by the `notify_bottle_matched()`
 * database trigger (migration 015) when a bottle transitions unmatched → matched.
 *
 * Realtime is ONLY a cache-refresh hint here — it makes the UI react quickly
 * when the socket happens to be alive. It does not own any user-facing state:
 * the Received/Delivered banners derive from server state (unread bottle /
 * unacked delivery, migration 016) and surface on any refetch path — realtime
 * invalidation, the slow fallback poll, navigation, or reload. A missed event
 * delays a notification; it can never lose one.
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
    let channel: RealtimeChannel | null = null
    let cancelled = false

    const subscribe = async () => {
      // Private channels require the realtime socket to carry the user's JWT —
      // setAuth() pulls the current session token onto the connection.
      await supabase.realtime.setAuth()
      if (cancelled) return

      channel = supabase
        .channel(`user:${user.id}`, { config: { private: true } })
        .on('broadcast', { event: 'bottle_received' }, () => {
          // A bottle arrived — refetch inbox + status; ReceivedBanner derives
          // its visibility from the refetched unread state.
          dispatch(
            bottleApi.util.invalidateTags(['BottleStatus', 'ReceivedBottles'])
          )
        })
        .on('broadcast', { event: 'bottle_delivered' }, () => {
          // A sent bottle was matched — refetch status; DeliveredBanner derives
          // from unackedDelivered, and the matched bottle drops out of
          // sailingBottles (it animates out of the sea).
          dispatch(bottleApi.util.invalidateTags(['BottleStatus']))
        })
        .on('broadcast', { event: 'thread_initiated' }, () => {
          // Someone wants to keep talking — show in Threads tab as pending.
          dispatch(bottleApi.util.invalidateTags(['Threads']))
        })
        .on('broadcast', { event: 'thread_accepted' }, () => {
          // Recipient accepted — initiator's thread is now active.
          dispatch(bottleApi.util.invalidateTags(['Threads']))
        })
        .on('broadcast', { event: 'thread_message' }, () => {
          // New message in a thread — refresh threads + the specific messages.
          dispatch(bottleApi.util.invalidateTags(['Threads']))
        })
        .subscribe()
    }

    void subscribe()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [user?.id, dispatch])

  return null
}
