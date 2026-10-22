'use client'

import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetFriendshipsQuery, useGetMyProfileQuery } from '@/store/api/socialApi'

/** Signed-in user's social profile + accepted friend ids. */
export function useMe() {
  const uid = useAppSelector(selectUser)?.id
  const profile = useGetMyProfileQuery(uid ?? '', { skip: !uid })
  const friendships = useGetFriendshipsQuery(undefined, { skip: !uid })
  const rows = friendships.data ?? []
  const friendIds = rows
    .filter((f) => f.status === 'accepted')
    .map((f) => (f.requester_id === uid ? f.addressee_id : f.requester_id))
  return {
    uid,
    me: profile.data ?? null,
    isLoading: !uid || profile.isLoading,
    friendships: rows,
    friendsReady: friendships.isSuccess,
    friendIds,
    pendingIn: rows.filter((f) => f.status === 'pending' && f.addressee_id === uid).length,
  }
}

/** Human copy for a failed social write (codes from socialApi's fail()). */
export function socialError(err: unknown, taken = 'That name is taken.'): string {
  const e = err as { error?: string; data?: { code?: string } } | undefined
  switch (e?.data?.code) {
    case 'P0001': return 'You’re going fast. Take a breath and try again in a bit.'
    case '23505': return taken
    case '23514': return 'That isn’t allowed. Try something else.'
    default: return 'Something went wrong. Please try again.'
  }
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
