import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { Bottle, DailyQuota } from '@/types'

export interface TodayBottleStatus {
  quota: DailyQuota
  sentBottle: Bottle | null
  receivedBottle: Bottle | null
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
    // Route derives identity from session cookie — no userId param needed.
    getTodayBottleStatus: builder.query<TodayBottleStatus, void>({
      query: () => '/bottles/status',
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
    // Route derives identity from session cookie — no userId param needed.
    getReceivedBottles: builder.query<Bottle[], void>({
      query: () => '/bottles/received',
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
      query: () => '/bottles/count',
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
