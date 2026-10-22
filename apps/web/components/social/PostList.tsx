'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { spring } from '@/components/ui/springs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { FEED_PAGE, useGetFeedQuery } from '@/store/api/socialApi'
import type { FeedSort } from '@/types/social'
import PostCard from './PostCard'
import { useMe } from './useMe'

export default function PostList({ sort = 'new', communityId, authorId, empty }: {
  sort?: FeedSort
  communityId?: string
  authorId?: string
  empty: string
}) {
  const { uid, friendIds, friendsReady } = useMe()
  const [limit, setLimit] = useState(FEED_PAGE)
  const [fresh, setFresh] = useState(0)
  const friends = sort === 'friends'
  const { data, isLoading, isFetching, isError, refetch } = useGetFeedQuery(
    { sort, communityId, authorId, friendIds: friends ? friendIds : undefined, limit },
    { skip: !uid || (friends && !friendsReady) },
  )

  // Someone else posted: offer a refresh instead of reshuffling what you're
  // reading (and instead of every open feed refetching on every post).
  // ponytail: counts posts anywhere, not just ones this list would show.
  useEffect(() => {
    if (!uid) return
    const supabase = createClient()
    const ch = supabase
      .channel(`posts-${sort}-${communityId ?? ''}-${authorId ?? ''}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (p) => {
        if ((p.new as { author_id?: string }).author_id !== uid) setFresh((n) => n + 1)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, sort, communityId, authorId])

  useEffect(() => { setLimit(FEED_PAGE); setFresh(0) }, [sort, communityId, authorId])

  if (!uid) return null
  if (isLoading || (friends && !friendsReady)) return <div className="skeleton h-40 rounded-3xl" />
  if (isError) {
    return (
      <Card material="flat" className="flex flex-col items-center gap-3 text-center font-ui text-sm text-sand/60">
        Couldn’t load posts.
        <Button size="sm" variant="glass" onClick={() => refetch()}>Try again</Button>
      </Card>
    )
  }
  if (!data?.length) return <Card material="flat" className="text-center font-ui text-sm text-sand/50">{empty}</Card>
  return (
    <>
      {fresh > 0 && (
        <Button size="sm" variant="tint" className="self-center"
          onClick={() => { setFresh(0); refetch() }}>
          {fresh === 1 ? '1 new post' : `${fresh} new posts`}
        </Button>
      )}
      {data.map((p, i) => (
        <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: Math.min(i, 6) * 0.04 }}>
          <PostCard post={p} userId={uid} />
        </motion.div>
      ))}
      {data.length >= limit && (
        <Button variant="glass" className="self-center" disabled={isFetching}
          onClick={() => setLimit((l) => l + FEED_PAGE)}>
          {isFetching ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </>
  )
}
