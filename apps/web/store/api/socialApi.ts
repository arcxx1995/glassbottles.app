import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { createClient } from '@/lib/supabase/client'
import type {
  Comment, Community, FeedSort, Friendship, Post, Scrap, SocialProfile,
} from '@/types/social'

// Every endpoint is a Supabase-direct queryFn (RLS is the gate) — no Vercel
// route in the path, so there is nothing to bill and no polling here at all.
// Fresh posts arrive via Realtime (PostList's "new posts" pill), not polling.

const POST_SELECT =
  '*, author:social_profiles!posts_author_id_fkey(handle, avatar_url), ' +
  'community:communities(slug, name), my_vote:post_votes(value)'

// `data.code` carries the SQLSTATE (23505 unique, 23514 check, P0001
// rate_limited) so the UI can say something specific — see socialError().
type Fail = { error: { status: 'CUSTOM_ERROR'; error: string; data: { code?: string } } }
const fail = (message: string, code?: string): Fail =>
  ({ error: { status: 'CUSTOM_ERROR', error: message, data: { code } } })

/** Run a Supabase call, normalising the {data,error} pair into RTK's shape.
 *  `any` data: rows come back untyped (no generated DB types); each endpoint's
 *  generic fixes the shape the UI sees. */
async function run(
  q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Fail | { data: any }> {
  const { data, error } = await q
  return error ? fail(error.message, error.code) : { data }
}

export const FEED_PAGE = 25
const HOT_WINDOW_MS = 7 * 864e5

export interface FeedArgs {
  sort: FeedSort
  communityId?: string
  authorId?: string
  /** Only for sort 'friends'; never part of other sorts' cache keys. */
  friendIds?: string[]
  /** Grows by FEED_PAGE per "Load more". */
  limit: number
}

export interface CommunityRef { id: string; slug: string; name: string }

export const socialApi = createApi({
  reducerPath: 'socialApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Me', 'Profile', 'Feed', 'Comments', 'Friends', 'Communities', 'Scraps'],
  endpoints: (b) => ({
    getMyProfile: b.query<SocialProfile | null, string>({
      queryFn: async (uid) =>
        run(createClient().from('social_profiles').select('*').eq('user_id', uid).maybeSingle()),
      providesTags: ['Me'],
    }),
    getProfileByHandle: b.query<SocialProfile | null, string>({
      queryFn: async (handle) =>
        run(createClient().from('social_profiles').select('*').eq('handle', handle).maybeSingle()),
      providesTags: ['Profile'],
    }),
    claimHandle: b.mutation<SocialProfile, { userId: string; handle: string }>({
      queryFn: async ({ userId, handle }) =>
        run(createClient().from('social_profiles')
          .insert({ user_id: userId, handle: handle.toLowerCase() }).select().single()),
      invalidatesTags: ['Me'],
    }),
    updateProfile: b.mutation<void, { userId: string; bio: string }>({
      queryFn: async ({ userId, bio }) =>
        run(createClient().from('social_profiles').update({ bio }).eq('user_id', userId)),
      invalidatesTags: ['Me', 'Profile'],
    }),

    // ponytail: "Load more" re-fetches the whole list at a bigger limit;
    // switch to a cursor + merge if feeds get long enough for that to hurt.
    getFeed: b.query<Post[], FeedArgs>({
      queryFn: async ({ sort, communityId, authorId, friendIds, limit }) => {
        if (sort === 'friends' && !friendIds?.length) return { data: [] }
        let q = createClient().from('posts').select(POST_SELECT).limit(limit)
        if (communityId) q = q.eq('community_id', communityId)
        if (authorId) q = q.eq('author_id', authorId)
        if (sort === 'friends') q = q.in('author_id', friendIds!)
        // Hot = best of the last week, so an old top post can't sit there forever.
        q = sort === 'hot'
          ? q.gte('created_at', new Date(Date.now() - HOT_WINDOW_MS).toISOString())
            .order('score', { ascending: false }).order('created_at', { ascending: false })
          : q.order('created_at', { ascending: false })
        return run(q)
      },
      providesTags: ['Feed'],
    }),
    createPost: b.mutation<void, { authorId: string; body: string; communityId?: string | null }>({
      queryFn: async ({ authorId, body, communityId }) =>
        run(createClient().from('posts')
          .insert({ author_id: authorId, body, community_id: communityId ?? null })),
      invalidatesTags: ['Feed'],
    }),
    deletePost: b.mutation<void, string>({
      queryFn: async (id) => run(createClient().from('posts').delete().eq('id', id)),
      invalidatesTags: ['Feed'],
    }),
    // value 0 clears the vote. Server trigger keeps posts.score honest; the
    // cached post is patched optimistically (no feed refetch per click), and
    // the next click reads the patched vote, so rapid clicks stay consistent.
    votePost: b.mutation<void, { postId: string; userId: string; value: 1 | -1 | 0; prev: 1 | -1 | 0 }>({
      queryFn: async ({ postId, userId, value }) => {
        const t = createClient().from('post_votes')
        return value === 0
          ? run(t.delete().eq('post_id', postId).eq('user_id', userId))
          : run(t.upsert({ post_id: postId, user_id: userId, value }))
      },
      async onQueryStarted({ postId, value, prev }, { dispatch, getState, queryFulfilled }) {
        const patches = socialApi.util
          .selectCachedArgsForQuery(getState(), 'getFeed')
          .map((args) => dispatch(socialApi.util.updateQueryData('getFeed', args, (posts) => {
            const p = posts.find((x) => x.id === postId)
            if (!p) return
            p.score += value - prev
            p.my_vote = value ? [{ value }] : []
          })))
        try {
          await queryFulfilled
        } catch {
          patches.forEach((p) => p.undo())
        }
      },
    }),

    getComments: b.query<Comment[], string>({
      queryFn: async (postId) =>
        run(createClient().from('comments')
          .select('*, author:social_profiles!comments_author_id_fkey(handle, avatar_url)')
          .eq('post_id', postId).order('created_at')),
      providesTags: ['Comments'],
    }),
    addComment: b.mutation<void, { postId: string; authorId: string; body: string; parentId?: string | null }>({
      queryFn: async ({ postId, authorId, body, parentId }) =>
        run(createClient().from('comments')
          .insert({ post_id: postId, author_id: authorId, body, parent_id: parentId ?? null })),
      invalidatesTags: ['Comments', 'Feed'],
    }),

    getFriendships: b.query<Friendship[], void>({
      queryFn: async () => run(createClient().from('friendships').select('*')),
      providesTags: ['Friends'],
    }),
    requestFriend: b.mutation<void, { from: string; to: string }>({
      queryFn: async ({ from, to }) =>
        run(createClient().from('friendships').insert({ requester_id: from, addressee_id: to })),
      invalidatesTags: ['Friends'],
    }),
    acceptFriend: b.mutation<void, { requester: string; me: string }>({
      queryFn: async ({ requester, me }) =>
        run(createClient().from('friendships').update({ status: 'accepted' })
          .eq('requester_id', requester).eq('addressee_id', me)),
      invalidatesTags: ['Friends'],
    }),
    removeFriend: b.mutation<void, { a: string; b: string }>({
      queryFn: async ({ a, b: other }) =>
        run(createClient().from('friendships').delete()
          .or(`and(requester_id.eq.${a},addressee_id.eq.${other}),and(requester_id.eq.${other},addressee_id.eq.${a})`)),
      invalidatesTags: ['Friends'],
    }),
    suggestProfiles: b.query<SocialProfile[], string>({
      queryFn: async (me) =>
        run(createClient().from('social_profiles').select('*').neq('user_id', me)
          .order('created_at', { ascending: false }).limit(20)),
      providesTags: ['Friends'],
    }),
    // Handles of friends (accepted) — used for names in the panels.
    getProfilesByIds: b.query<SocialProfile[], string[]>({
      queryFn: async (ids) =>
        ids.length
          ? run(createClient().from('social_profiles').select('*').in('user_id', ids))
          : { data: [] },
    }),

    // Directory: newest first. Single lookups go through getCommunityBySlug,
    // never a client-side search of this (capped) list.
    getCommunities: b.query<Community[], void>({
      queryFn: async () =>
        run(createClient().from('communities')
          .select('*, members:community_members(count)')
          .order('created_at', { ascending: false }).limit(50)),
      providesTags: ['Communities'],
    }),
    getCommunityBySlug: b.query<Community | null, string>({
      queryFn: async (slug) =>
        run(createClient().from('communities')
          .select('*, members:community_members(count)').eq('slug', slug).maybeSingle()),
      providesTags: ['Communities'],
    }),
    getMyCommunities: b.query<CommunityRef[], string>({
      queryFn: async (uid) => {
        const r = await run(createClient().from('community_members')
          .select('community:communities(id, slug, name)').eq('user_id', uid)
          .order('joined_at', { ascending: false }))
        return 'error' in r ? r : { data: (r.data as { community: CommunityRef }[]).map((m) => m.community) }
      },
      providesTags: ['Communities'],
    }),
    createCommunity: b.mutation<void, { slug: string; name: string; description: string; userId: string }>({
      queryFn: async ({ slug, name, description, userId }) =>
        run(createClient().from('communities')
          .insert({ slug: slug.toLowerCase(), name, description, created_by: userId })),
      invalidatesTags: ['Communities'],
    }),
    setMembership: b.mutation<void, { communityId: string; userId: string; join: boolean }>({
      queryFn: async ({ communityId, userId, join }) => {
        const t = createClient().from('community_members')
        return join
          ? run(t.insert({ community_id: communityId, user_id: userId }))
          : run(t.delete().eq('community_id', communityId).eq('user_id', userId))
      },
      invalidatesTags: ['Communities'],
    }),

    getScraps: b.query<Scrap[], string>({
      queryFn: async (wallId) =>
        run(createClient().from('scraps')
          .select('*, author:social_profiles!scraps_author_id_fkey(handle, avatar_url)')
          .eq('wall_id', wallId).order('created_at', { ascending: false }).limit(50)),
      providesTags: ['Scraps'],
    }),
    addScrap: b.mutation<void, { wallId: string; authorId: string; body: string; kind: 'scrap' | 'testimonial' }>({
      queryFn: async ({ wallId, authorId, body, kind }) =>
        run(createClient().from('scraps').insert({
          wall_id: wallId, author_id: authorId, body, kind, approved: kind === 'scrap',
        })),
      invalidatesTags: ['Scraps'],
    }),
    approveScrap: b.mutation<void, string>({
      queryFn: async (id) => run(createClient().from('scraps').update({ approved: true }).eq('id', id)),
      invalidatesTags: ['Scraps'],
    }),
    deleteScrap: b.mutation<void, string>({
      queryFn: async (id) => run(createClient().from('scraps').delete().eq('id', id)),
      invalidatesTags: ['Scraps'],
    }),
    report: b.mutation<void, { reporterId: string; type: 'post' | 'comment' | 'scrap' | 'profile'; targetId: string }>({
      queryFn: async ({ reporterId, type, targetId }) =>
        run(createClient().from('social_reports')
          .insert({ reporter_id: reporterId, target_type: type, target_id: targetId })),
    }),
  }),
})

export const {
  useGetMyProfileQuery, useGetProfileByHandleQuery, useClaimHandleMutation, useUpdateProfileMutation,
  useGetFeedQuery, useCreatePostMutation, useDeletePostMutation, useVotePostMutation,
  useGetCommentsQuery, useAddCommentMutation,
  useGetFriendshipsQuery, useRequestFriendMutation, useAcceptFriendMutation, useRemoveFriendMutation,
  useSuggestProfilesQuery, useGetProfilesByIdsQuery,
  useGetCommunitiesQuery, useGetCommunityBySlugQuery, useGetMyCommunitiesQuery, useCreateCommunityMutation, useSetMembershipMutation,
  useGetScrapsQuery, useAddScrapMutation, useApproveScrapMutation, useDeleteScrapMutation,
  useReportMutation,
} = socialApi
