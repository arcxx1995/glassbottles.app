'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { bottleApi } from '@/store/api/bottleApi'
import { setShowReceivedBanner, setShowDeliveredBanner } from '@/store/uiSlice'
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

/**
 * RealtimeBottleListener
 *
 * Mounts once in the (app) layout. Subscribes to the user's private Broadcast
 * topic `user:<uuid>` — events are sent by the `notify_bottle_matched()`
 * database trigger (migration 015) when a bottle transitions unmatched → matched:
 *
 * - `bottle_received` — a bottle arrived in this user's inbox. Invalidates the
 *   RTK Query cache + shows the ReceivedBanner toast.
 * - `bottle_delivered` — the user's own sent bottle was matched. Shows the
 *   persistent "delivered" toast and invalidates BottleStatus — the refetched
 *   sailingBottles array no longer contains the bottle, so it leaves the sea.
 *
 * SECURITY: broadcast replaced postgres_changes here on purpose. WALRUS
 * payloads carried whole rows (including sender_id/receiver_id) to anyone
 * passing the RLS row check — a devtools-level anonymity leak. The broadcast
 * payload contains only what the trigger sends (a bottle id), and the RLS
 * policy on realtime.messages restricts each client to its own topic.
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
          // Bottle matched to this user — refresh inbox + status
          dispatch(
            bottleApi.util.invalidateTags(['BottleStatus', 'ReceivedBottles'])
          )
          // Show in-app toast banner
          dispatch(setShowReceivedBanner(true))
        })
        .on('broadcast', { event: 'bottle_delivered' }, () => {
          // Persistent toast — stays on the sailing screen until dismissed
          dispatch(setShowDeliveredBanner(true))
          // Refetch status: the matched bottle drops out of sailingBottles,
          // so it animates out of the sea (a bottle vanishes).
          dispatch(bottleApi.util.invalidateTags(['BottleStatus']))
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
