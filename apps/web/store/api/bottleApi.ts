import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { createClient } from '@/lib/supabase/client'
import type {
  Bottle,
  DailyQuota,
  Mood,
  MoodStreakStatus,
  MoodCheckInResult,
  SavedBottle,
  SaveResult,
} from '@/types'

/** Lightweight shape for floating bottles — only what the sea renders.
 *  No message/receiver fields leak; just id (key) and day_key (date label). */
export interface SailingBottle {
  id: string
  message: string
  sent_at: string
  day_key: string
}

/** A sent bottle that was matched but whose "delivered" toast the sender has
 *  not yet acknowledged. Drives the persistent DeliveredBanner. No receiver
 *  fields — anonymity enforced at the RPC level. */
export interface UnackedDeliveredBottle {
  id: string
  sent_at: string
  received_at: string
  day_key: string
}

export interface TodayBottleStatus {
  quota: DailyQuota
  sentBottle: Bottle | null
  receivedBottle: Bottle | null
  sailingBottles: SailingBottle[]
  unackedDelivered: UnackedDeliveredBottle[]
}

export interface SendBottleRequest {
  message: string
}

export interface BottleCountResponse {
  count: number
  date: string
}

/** Precomputed public landing stats (migration 021). */
export interface PublicStats {
  adriftCount: number
  totalCount: number
}

export const bottleApi = createApi({
  reducerPath: 'bottleApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: [
    'BottleStatus',
    'ReceivedBottles',
    'BottleCount',
    'MoodStreak',
    'SavedBottles',
  ],
  endpoints: (builder) => ({
    // Reads go straight to Supabase via SECURITY DEFINER RPCs (migration 014) —
    // no Vercel Function in the path, so polling costs zero compute. The RPCs
    // derive identity from auth.uid() and return only anonymity-safe columns.
    getTodayBottleStatus: builder.query<TodayBottleStatus, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_today_bottle_status')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as TodayBottleStatus }
      },
      providesTags: ['BottleStatus'],
    }),
    sendBottle: builder.mutation<Bottle, SendBottleRequest>({
      // Single atomic Supabase RPC (migration 024) — replaces the
      // /api/bottles/send Vercel route. One round trip, no Function cold start.
      queryFn: async ({ message }) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('send_bottle', {
          p_message: message,
        })
        if (error) {
          // Surface the SQLSTATE so the UI can distinguish "already sent" (23505)
          // from a real failure. RTK's CUSTOM_ERROR carries it on `data`.
          return {
            error: {
              status: 'CUSTOM_ERROR' as const,
              error: error.message,
              data: { code: error.code },
            },
          }
        }
        return { data: data as Bottle }
      },
      // Optimistic: flip today's quota.has_sent the instant the throw fires so
      // "Sent today ✓", the drift copy and the DailyTimer appear immediately
      // instead of waiting on the round trip (the old perceived freeze). The
      // BottleStatus invalidation then reconciles with server truth (and swaps
      // the optimistic sea placeholder for the real bottle).
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          bottleApi.util.updateQueryData(
            'getTodayBottleStatus',
            undefined,
            (draft) => {
              if (draft?.quota) draft.quota.has_sent = true
            }
          )
        )
        try {
          await queryFulfilled
        } catch {
          patch.undo()
        }
      },
      // Invalidate both status (quota + sent bottle) and the ambient counter so the
      // "X bottles in the ocean" display refreshes immediately after a successful throw.
      invalidatesTags: ['BottleStatus', 'BottleCount'],
    }),
    getReceivedBottles: builder.query<Bottle[], void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_received_bottles')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: (data ?? []) as Bottle[] }
      },
      providesTags: ['ReceivedBottles'],
    }),
    // Sender dismisses the "Your bottle found someone" toast. Persisted in the
    // DB (delivered_ack_at) so the dismissal holds across reloads and devices.
    ackDeliveredBottles: builder.mutation<void, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { error } = await supabase.rpc('ack_delivered_bottles')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      invalidatesTags: ['BottleStatus'],
    }),
    markBottleRead: builder.mutation<void, string>({
      query: (bottleId) => ({
        url: `/bottles/${bottleId}/read`,
        method: 'PATCH',
      }),
      invalidatesTags: ['BottleStatus', 'ReceivedBottles'],
    }),
    reportBottle: builder.mutation<void, string>({
      query: (bottleId) => ({
        url: `/bottles/${bottleId}/report`,
        method: 'POST',
      }),
      invalidatesTags: ['ReceivedBottles'],
    }),
    // Ambient social proof counter — total bottles thrown today across all users.
    // No PII. Refreshes every 5 minutes; not critical-path.
    getBottleCount: builder.query<BottleCountResponse, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_todays_bottle_count')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return {
          data: {
            count: (data as number | null) ?? 0,
            date: new Date().toISOString().split('T')[0],
          },
        }
      },
      providesTags: ['BottleCount'],
    }),

    // ── Mood check-in + streak (migration 025) ──────────────────────────────
    // Supabase-direct RPCs (queryFn), no Vercel route. The retention spine:
    // a low-bar daily ritual that anchors the ADHD-safe streak.
    getMoodStreak: builder.query<MoodStreakStatus, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_mood_streak_status')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as MoodStreakStatus }
      },
      providesTags: ['MoodStreak'],
    }),
    checkInMood: builder.mutation<MoodCheckInResult, Mood>({
      queryFn: async (mood) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('check_in_mood', { p_mood: mood })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as MoodCheckInResult }
      },
      // Optimistic: paint today's mood + checked-in state instantly so the
      // weather picker collapses to the chosen mood with no round-trip flicker.
      async onQueryStarted(mood, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          bottleApi.util.updateQueryData('getMoodStreak', undefined, (draft) => {
            if (draft) {
              draft.today_mood = mood
              draft.checked_in_today = true
              draft.at_risk = false
            }
          })
        )
        try {
          await queryFulfilled
        } catch {
          patch.undo()
        }
      },
      invalidatesTags: ['MoodStreak'],
    }),

    // ── Save shelf (migration 026) ──────────────────────────────────────────
    getSavedBottles: builder.query<SavedBottle[], void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_saved_bottles')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: (data ?? []) as SavedBottle[] }
      },
      providesTags: ['SavedBottles'],
    }),
    saveBottle: builder.mutation<SaveResult, string>({
      queryFn: async (bottleId) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('save_bottle', {
          p_bottle_id: bottleId,
        })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as SaveResult }
      },
      invalidatesTags: ['SavedBottles'],
    }),
    unsaveBottle: builder.mutation<SaveResult, string>({
      queryFn: async (bottleId) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('unsave_bottle', {
          p_bottle_id: bottleId,
        })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as SaveResult }
      },
      invalidatesTags: ['SavedBottles'],
    }),

    // Public landing-page stats — reads ONE precomputed row (migration 021),
    // never a live COUNT. Granted to anon, so it works unauthenticated.
    //   adrift_count = undelivered bottles at sea now (refreshed hourly)
    //   total_count  = all bottles ever thrown (refreshed daily)
    getPublicStats: builder.query<PublicStats, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_public_stats')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        // RPC returns a single-row set.
        const row = Array.isArray(data) ? data[0] : data
        return {
          data: {
            adriftCount: row?.adrift_count ?? 0,
            totalCount: row?.total_count ?? 0,
          },
        }
      },
    }),
  }),
})

export const {
  useGetTodayBottleStatusQuery,
  useSendBottleMutation,
  useGetReceivedBottlesQuery,
  useMarkBottleReadMutation,
  useReportBottleMutation,
  useGetBottleCountQuery,
  useGetPublicStatsQuery,
  useAckDeliveredBottlesMutation,
  useGetMoodStreakQuery,
  useCheckInMoodMutation,
  useGetSavedBottlesQuery,
  useSaveBottleMutation,
  useUnsaveBottleMutation,
} = bottleApi
