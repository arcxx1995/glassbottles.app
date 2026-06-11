'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { bottleApi } from '@/store/api/bottleApi'
import { setShowReceivedBanner, setShowDeliveredBanner } from '@/store/uiSlice'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Bottle } from '@/types'

/**
 * RealtimeBottleListener
 *
 * Mounts once in the (app) layout. Opens two Supabase Realtime channels:
 *
 * 1. receiver channel — fires when a bottle is assigned to this user as
 *    receiver. Invalidates RTK Query cache + shows the ReceivedBanner toast.
 *
 * 2. sender channel — fires when the user's own sent bottle is matched to a
 *    receiver (received_at: null → timestamp). Shows the persistent "delivered"
 *    toast and invalidates BottleStatus — the refetched sailingBottles array no
 *    longer contains the matched bottle, so it vanishes from the sea.
 *
 * Returns null — no UI.
 */
export default function RealtimeBottleListener() {
  const dispatch = useAppDispatch()
  const user = useAppSelector(selectUser)
  // Stable ref — avoids recreating the Supabase client on every render
  const supabaseRef = useRef<SupabaseClient>(createClient())

  // ── Channel 1: receiver — a bottle arrived in the user's inbox ────────────
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

  // ── Channel 2: sender — the user's sent bottle was matched to a receiver ──
  //
  // We subscribe to UPDATE events on bottles where sender_id = this user.
  // Because REPLICA IDENTITY FULL is set (migration 008), the OLD row image is
  // complete — Supabase Realtime will include old.received_at in the payload.
  //
  // Guard: only fire the delivered toast when received_at actually transitioned
  // from null → a value. This prevents re-triggering if the row is updated for
  // unrelated reasons (e.g. is_read, is_stale).
  useEffect(() => {
    if (!user?.id) return

    const supabase = supabaseRef.current
    const channelName = `bottles:sender:${user.id}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bottles',
          filter: `sender_id=eq.${user.id}`,
        },
        (payload: { old: Partial<Bottle>; new: Partial<Bottle> }) => {
          const wasUnmatched = payload.old.received_at == null
          const isNowMatched = payload.new.received_at != null

          if (wasUnmatched && isNowMatched) {
            // Persistent toast — stays on the sailing screen until dismissed
            dispatch(setShowDeliveredBanner(true))
            // Refetch status: the matched bottle drops out of sailingBottles,
            // so it animates out of the sea (a bottle vanishes).
            dispatch(bottleApi.util.invalidateTags(['BottleStatus']))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, dispatch])

  return null
}
