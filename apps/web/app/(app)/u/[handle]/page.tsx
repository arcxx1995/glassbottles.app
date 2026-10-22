'use client'

import { TransitionLink as Link } from '@/components/ui/TransitionLink'
import { useState } from 'react'
import { Settings } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import PostList from '@/components/social/PostList'
import Wall from '@/components/social/Wall'
import { useMe } from '@/components/social/useMe'
import {
  useAcceptFriendMutation, useGetProfileByHandleQuery, useRemoveFriendMutation, useRequestFriendMutation,
} from '@/store/api/socialApi'

const TABS = [
  { value: 'wall', label: 'Wall' },
  { value: 'posts', label: 'Posts' },
] as const

export default function ProfilePage() {
  const { handle } = useParams<{ handle: string }>()
  const { uid, friendships } = useMe()
  const { data: profile, isLoading } = useGetProfileByHandleQuery(handle.toLowerCase())
  const [tab, setTab] = useState<'wall' | 'posts'>('wall')
  const [request] = useRequestFriendMutation()
  const [accept] = useAcceptFriendMutation()
  const [remove] = useRemoveFriendMutation()

  if (isLoading || !uid) return <div className="skeleton h-40 rounded-3xl" />
  if (!profile) return <Card className="text-center font-ui text-sm text-sand/60">No one goes by @{handle}.</Card>

  const isMe = profile.user_id === uid
  const f = friendships.find((x) => x.requester_id === profile.user_id || x.addressee_id === profile.user_id)

  return (
    <>
      <Card material="strong" className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Avatar handle={profile.handle} src={profile.avatar_url} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-title text-sand">@{profile.handle}</h1>
            <p className="font-ui text-sm text-sand/60">{profile.bio || (isMe ? 'Add a bio in Settings.' : 'No bio yet.')}</p>
          </div>
          {isMe && (
            <Link href="/settings" aria-label="Settings"
              className="glass-fill press inline-flex h-11 w-11 items-center justify-center rounded-full text-sand/80 hover:bg-white/[0.11] transition-[background-color,transform]">
              <Settings size={18} />
            </Link>
          )}
          {!isMe && (
            !f ? <Button onClick={() => request({ from: uid, to: profile.user_id })}>Add friend</Button>
            : f.status === 'accepted' ? <Button variant="glass" onClick={() => remove({ a: uid, b: profile.user_id })}>Friends</Button>
            : f.addressee_id === uid ? <Button onClick={() => accept({ requester: profile.user_id, me: uid })}>Accept</Button>
            : <Button variant="glass" onClick={() => remove({ a: uid, b: profile.user_id })}>Requested</Button>
          )}
        </div>
      </Card>
      <Tabs tabs={TABS} value={tab} onChange={setTab} id="profile-tab" className="self-start" />
      {tab === 'wall'
        ? <Wall wallId={profile.user_id} meId={uid} isOwner={isMe} />
        : <PostList sort="new" authorId={profile.user_id} empty="No posts yet." />}
    </>
  )
}
