'use client'

import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import Composer from '@/components/social/Composer'
import PostList from '@/components/social/PostList'
import { useMe } from '@/components/social/useMe'
import { useGetCommunityBySlugQuery, useGetMyCommunitiesQuery, useSetMembershipMutation } from '@/store/api/socialApi'

export default function CommunityPage() {
  const { slug } = useParams<{ slug: string }>()
  const { uid } = useMe()
  const { data: c, isLoading } = useGetCommunityBySlugQuery(slug.toLowerCase())
  const mine = useGetMyCommunitiesQuery(uid ?? '', { skip: !uid })
  const [setMembership, { isLoading: busy }] = useSetMembershipMutation()

  if (isLoading || !uid) return <div className="skeleton h-40 rounded-3xl" />
  if (!c) return <Card className="text-center font-ui text-sm text-sand/60">No community called c/{slug}.</Card>

  const joined = !!mine.data?.some((m) => m.id === c.id)
  const owner = c.created_by === uid
  return (
    <>
      <Card material="strong" className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-title text-sand">{c.name}</h1>
          <p className="font-ui text-sm text-sand/60">c/{c.slug} · {c.members[0]?.count ?? 0} members</p>
          {c.description && <p className="mt-2 font-ui text-sm text-sand/80">{c.description}</p>}
        </div>
        {!owner && (
          <Button variant={joined ? 'glass' : 'primary'} disabled={busy}
            onClick={() => setMembership({ communityId: c.id, userId: uid, join: !joined })}>
            {joined ? 'Leave' : 'Join'}
          </Button>
        )}
      </Card>
      {joined && <Composer communityId={c.id} />}
      <PostList sort="new" communityId={c.id} empty="No posts in this community yet." />
    </>
  )
}
