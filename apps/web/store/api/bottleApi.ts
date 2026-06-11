import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { createClient } from '@/lib/supabase/client'
import type { Bottle, DailyQuota } from '@/types'

/** Lightweight shape for floating bottles — only what the sea renders.
 *  No message/receiver fields leak; just id (key) and day_key (date label). */
export interface SailingBottle {
  id: string
  message: string
  sent_at: string
  day_key: string
}

export interface TodayBottleStatus {
  quota: DailyQuota
  sentBottle: Bottle | null
  receivedBottle: Bottle | null
  sailingBottles: SailingBottle[]
}

export interface SendBottleRequest {
  message: string
}

export interface BottleCountResponse {
  count: number
  date: string
}

export const bottleApi = createApi({
  reducerPath: 'bottleApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['BottleStatus', 'ReceivedBottles', 'BottleCount'],
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
      query: (body) => ({
        url: '/bottles/send',
        method: 'POST',
        body,
      }),
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
  }),
})

export const {
  useGetTodayBottleStatusQuery,
  useSendBottleMutation,
  useGetReceivedBottlesQuery,
  useMarkBottleReadMutation,
  useReportBottleMutation,
  useGetBottleCountQuery,
} = bottleApi
