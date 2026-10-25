import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { createClient } from '@/lib/supabase/client'
import type { Bottle, DailyQuota, ReportReason } from '@/types'
import type { AtelierPiece, BottleStyle, Vibe, Weather } from '@/lib/dressing'
import { hasAccess } from '@/lib/keeper'
import type { Harbour, Hull, Paddle } from '@/lib/harbour'

/** Lightweight shape for floating bottles — only what the sea renders.
 *  No message/receiver fields leak; just id (key) and day_key (date label). */
export interface SailingBottle {
  id: string
  message: string
  sent_at: string
  day_key: string
  /** Your own dressing — your sea shows the bottle you threw (042). */
  style?: BottleStyle | null
}

/** A sent bottle that was matched but whose "delivered" toast the sender has
 *  not yet acknowledged. Drives the persistent DeliveredBanner. No receiver
 *  fields — anonymity enforced at the RPC level. */
export interface UnackedDeliveredBottle {
  id: string
  sent_at: string
  received_at: string
  day_key: string
  /** How far it drifted — UTC-offset gap band, never a place (migration 039). */
  drift_band?: 'same' | 'near' | 'far' | 'distant' | null
}

export interface TodayBottleStatus {
  quota: DailyQuota
  sentBottle: Bottle | null
  receivedBottle: Bottle | null
  sailingBottles: SailingBottle[]
  unackedDelivered: UnackedDeliveredBottle[]
  /** Consecutive local days with a throw (migration 039). */
  tides?: number
  /** Latest bottle the safety screen kept ashore, not yet acknowledged
   *  (043; crisis since 052). Its throw for the day is already restored. */
  heldBottle?: HeldBottle | null
  /** Own bottles a stranger said reached them, not yet seen (044). */
  ripples?: { id: string; rippled_at: string }[]
  /** Today's whale window and whether you've spotted it (049). */
  whale?: { start: string; end: string; spotted: boolean }
}

/** Earn-only coins (049): balance, and owned coin pieces as 'kind:id'. */
export interface Coins {
  balance: number
  unlocked: string[]
}

/** A bottle the safety screen kept ashore — its words come back to rewrite. */
export interface HeldBottle {
  id: string
  message: string
  screen_reason: string | null
  day_key: string
}

export interface SendBottleRequest {
  message: string
  style?: BottleStyle
  weather?: Weather | null
  vibe?: Vibe | null
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

/** Keeper membership (migration 041). access_until decides access; the
 *  server re-checks with is_keeper() on every paid action. */
export interface Membership {
  plan: 'monthly' | 'yearly' | 'lifetime'
  status: string
  access_until: string
  keeper_since: string
}

/** Letters to yourself (migration 047): arrived ones whole, waiting ones sealed. */
export interface FutureBottles {
  arrived: {
    id: string
    message: string
    style: BottleStyle | null
    weather: Weather | null
    created_at: string
    delivered_at: string
    read_at: string | null
  }[]
  waiting: { id: string; deliver_on: string }[]
  can_send_after: string | null
}

export interface KeeperState {
  membership: Membership | null
  isKeeper: boolean
  foundingSpotsLeft: number
}

export const bottleApi = createApi({
  reducerPath: 'bottleApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['BottleStatus', 'ReceivedBottles', 'BottleCount', 'Membership', 'Future', 'Coins', 'Harbour', 'KayakBlocks'],
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
      queryFn: async ({ message, style, weather, vibe }) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('send_bottle', {
          p_message: message,
          p_style: style && Object.keys(style).length ? style : null,
          p_weather: weather ?? null,
          p_vibe: vibe ?? null,
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
      // A throw can complete a seventh tide (+5 coins, 049).
      invalidatesTags: ['BottleStatus', 'BottleCount', 'Coins'],
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
    // Read and report are Supabase RPCs (migration 038), off Vercel like
    // send_bottle — opening a bottle marks it read, so this is a hot path.
    // Each returns false when the bottle is not the caller's received bottle.
    // The sender has seen (or picked up to rewrite) a held bottle (043).
    ackHeldBottle: builder.mutation<void, string>({
      queryFn: async (bottleId) => {
        const supabase = createClient()
        const { error } = await supabase.rpc('ack_held_bottle', { p_bottle_id: bottleId })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      // Hide it at once; the refetch confirms.
      async onQueryStarted(_id, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          bottleApi.util.updateQueryData('getTodayBottleStatus', undefined, (draft) => {
            draft.heldBottle = null
          }),
        )
        queryFulfilled.catch(patch.undo)
      },
      invalidatesTags: ['BottleStatus'],
    }),
    // "This reached me" — the receiver's one quiet answer (044). Optimistic:
    // the button settles at once; a failure rolls it back.
    rippleBottle: builder.mutation<void, string>({
      queryFn: async (bottleId) => {
        const supabase = createClient()
        const { error } = await supabase.rpc('ripple_bottle', { p_bottle_id: bottleId })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      async onQueryStarted(bottleId, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          bottleApi.util.updateQueryData('getReceivedBottles', undefined, (draft) => {
            const b = draft.find((x) => x.id === bottleId)
            if (b) b.rippled_at = new Date().toISOString()
          }),
        )
        queryFulfilled.catch(patch.undo)
      },
    }),
    // Keep (or let go of) a received bottle as a keepsake (045). Optimistic.
    keepBottle: builder.mutation<void, { id: string; keep: boolean }>({
      queryFn: async ({ id, keep }) => {
        const supabase = createClient()
        const { error } = await supabase.rpc('keep_bottle', { p_bottle_id: id, p_keep: keep })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      async onQueryStarted({ id, keep }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          bottleApi.util.updateQueryData('getReceivedBottles', undefined, (draft) => {
            const b = draft.find((x) => x.id === id)
            if (b) b.kept_at = keep ? new Date().toISOString() : null
          }),
        )
        queryFulfilled.catch(patch.undo)
      },
    }),
    // The sender has seen their ripples (044).
    ackRipples: builder.mutation<void, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { error } = await supabase.rpc('ack_ripples')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          bottleApi.util.updateQueryData('getTodayBottleStatus', undefined, (draft) => {
            draft.ripples = []
          }),
        )
        queryFulfilled.catch(patch.undo)
      },
      invalidatesTags: ['BottleStatus'],
    }),
    markBottleRead: builder.mutation<void, string>({
      queryFn: async (bottleId) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('mark_bottle_read', {
          p_bottle_id: bottleId,
        })
        if (error || data !== true) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error?.message ?? 'Bottle not found' } }
        }
        return { data: undefined }
      },
      // Optimistic: the unread dot, nav badge and ReceivedBanner all read this
      // cache, so they clear the instant the bottle opens. Server state then
      // already matches — no refetch.
      async onQueryStarted(bottleId, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          bottleApi.util.updateQueryData('getReceivedBottles', undefined, (draft) => {
            const b = draft.find((x) => x.id === bottleId)
            if (b) {
              b.is_read = true
              b.read_at ??= new Date().toISOString()
            }
          })
        )
        try {
          await queryFulfilled
        } catch {
          patch.undo()
        }
      },
    }),
    reportBottle: builder.mutation<void, { bottleId: string; reason: ReportReason }>({
      queryFn: async ({ bottleId, reason }) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('report_bottle', {
          p_bottle_id: bottleId,
          p_reason: reason,
        })
        if (error || data !== true) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error?.message ?? 'Bottle not found' } }
        }
        return { data: undefined }
      },
      // Optimistic: a reported bottle leaves the inbox at once (038 keeps it
      // out of get_received_bottles); a failed report puts it back.
      async onQueryStarted({ bottleId }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          bottleApi.util.updateQueryData('getReceivedBottles', undefined, (draft) =>
            draft.filter((x) => x.id !== bottleId)
          )
        )
        try {
          await queryFulfilled
        } catch {
          patch.undo()
        }
      },
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

    // Coins (049): read, spend on a coin piece, earn by spotting the whale.
    getCoins: builder.query<Coins, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_coins')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as Coins }
      },
      providesTags: ['Coins'],
    }),
    unlockPiece: builder.mutation<number, { kind: string; id: string }>({
      queryFn: async ({ kind, id }) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('unlock_piece', { p_kind: kind, p_id: id })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as number }
      },
      invalidatesTags: ['Coins'],
    }),
    spotWhale: builder.mutation<boolean, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('spot_whale')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as boolean }
      },
      invalidatesTags: ['Coins', 'BottleStatus'],
    }),

    // Letters to yourself (047).
    getFutureBottles: builder.query<FutureBottles, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_future_bottles')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as FutureBottles }
      },
      providesTags: ['Future'],
    }),
    sendFutureBottle: builder.mutation<
      { id: string; deliver_on: string },
      { message: string; months: 1 | 6 | 12; style?: BottleStyle; weather?: Weather | null }
    >({
      queryFn: async ({ message, months, style, weather }) => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('send_future_bottle', {
          p_message: message,
          p_months: months,
          p_style: style && Object.keys(style).length ? style : null,
          p_weather: weather ?? null,
        })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message, data: { code: error.code } } }
        }
        return { data: data as { id: string; deliver_on: string } }
      },
      invalidatesTags: ['Future'],
    }),
    markFutureRead: builder.mutation<void, string>({
      queryFn: async (id) => {
        const supabase = createClient()
        const { error } = await supabase.rpc('mark_future_read', { p_id: id })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
    }),

    // The Atelier catalog (042): readable by everyone signed in, changes only
    // by migration — fetched once per session, never refetched.
    getAtelier: builder.query<AtelierPiece[], void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('atelier_pieces')
          .select('kind, id, name, tier, look, sort, coin_cost')
          .order('kind')
          .order('sort')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as AtelierPiece[] }
      },
      keepUnusedDataFor: 24 * 60 * 60,
    }),

    // Own membership row (RLS) + founding spots, straight from Supabase.
    // Refreshed by the 'membership' realtime broadcast, never polled.
    getKeeper: builder.query<KeeperState, void>({
      queryFn: async () => {
        const supabase = createClient()
        const [m, spots] = await Promise.all([
          supabase
            .from('memberships')
            .select('plan, status, access_until, keeper_since')
            .maybeSingle(),
          supabase.rpc('founding_spots_left'),
        ])
        const error = m.error ?? spots.error
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        const membership = m.data as Membership | null
        return {
          data: {
            membership,
            isKeeper:
              hasAccess(membership?.access_until),
            foundingSpotsLeft: (spots.data as number | null) ?? 0,
          },
        }
      },
      providesTags: ['Membership'],
    }),

    // The Harbour (056). Supabase-direct RPCs; the twelve change once a UTC
    // day, so nothing here polls. Errors carry the RPC's message
    // ('keeper_only', 'no_handle', 'content_not_allowed', ...).
    getHarbour: builder.query<Harbour, void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_harbour')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as Harbour }
      },
      providesTags: ['Harbour'],
    }),
    // A handle is a row in social_profiles (050): written directly under RLS,
    // with the blocklist guard (051) and the screen (056) behind it.
    claimHandle: builder.mutation<void, { handle: string; bio?: string }>({
      queryFn: async ({ handle, bio }) => {
        const supabase = createClient()
        const { data: auth } = await supabase.auth.getSession()
        const uid = auth.session?.user.id
        if (!uid) return { error: { status: 'CUSTOM_ERROR' as const, error: 'not authenticated' } }
        const { error } = await supabase
          .from('social_profiles')
          .insert({ user_id: uid, handle: handle.toLowerCase(), bio: bio?.trim() || null })
        if (error) {
          const taken = error.code === '23505'
          return { error: { status: 'CUSTOM_ERROR' as const, error: taken ? 'handle_taken' : error.message } }
        }
        return { data: undefined }
      },
      invalidatesTags: ['Harbour'],
    }),
    updateBio: builder.mutation<void, string>({
      queryFn: async (bio) => {
        const supabase = createClient()
        const { data: auth } = await supabase.auth.getSession()
        const uid = auth.session?.user.id
        if (!uid) return { error: { status: 'CUSTOM_ERROR' as const, error: 'not authenticated' } }
        const { error } = await supabase
          .from('social_profiles')
          .update({ bio: bio.trim() || null })
          .eq('user_id', uid)
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      invalidatesTags: ['Harbour'],
    }),
    saveKayak: builder.mutation<void, { hull: Hull; paddle: Paddle; parked: boolean }>({
      queryFn: async ({ hull, paddle, parked }) => {
        const supabase = createClient()
        const { error } = await supabase.rpc('save_kayak', { p_hull: hull, p_paddle: paddle, p_parked: parked })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      invalidatesTags: ['Harbour'],
    }),
    getKayakBlocks: builder.query<string[], void>({
      queryFn: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_kayak_blocks')
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: data as string[] }
      },
      providesTags: ['KayakBlocks'],
    }),
    blockKayak: builder.mutation<void, { handle: string; block: boolean }>({
      queryFn: async ({ handle, block }) => {
        const supabase = createClient()
        const { error } = await supabase.rpc('block_kayak', { p_handle: handle, p_block: block })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      invalidatesTags: ['Harbour', 'KayakBlocks'],
    }),
    // A report also hides that kayak from you at once (056).
    reportKayak: builder.mutation<void, { handle: string; reason: ReportReason }>({
      queryFn: async ({ handle, reason }) => {
        const supabase = createClient()
        const { error } = await supabase.rpc('report_kayak', { p_handle: handle, p_reason: reason })
        if (error) {
          return { error: { status: 'CUSTOM_ERROR' as const, error: error.message } }
        }
        return { data: undefined }
      },
      invalidatesTags: ['Harbour'],
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
  useGetKeeperQuery,
  useGetAtelierQuery,
  useAckHeldBottleMutation,
  useRippleBottleMutation,
  useAckRipplesMutation,
  useKeepBottleMutation,
  useGetFutureBottlesQuery,
  useSendFutureBottleMutation,
  useMarkFutureReadMutation,
  useGetCoinsQuery,
  useUnlockPieceMutation,
  useSpotWhaleMutation,
  useGetHarbourQuery,
  useClaimHandleMutation,
  useUpdateBioMutation,
  useSaveKayakMutation,
  useGetKayakBlocksQuery,
  useBlockKayakMutation,
  useReportKayakMutation,
} = bottleApi
