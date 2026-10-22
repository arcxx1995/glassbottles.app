'use client'

import { TransitionLink as Link } from '@/components/ui/TransitionLink'
import { useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import Composer from '@/components/social/Composer'
import PostList from '@/components/social/PostList'
import type { FeedSort } from '@/types/social'

const TABS = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
  { value: 'friends', label: 'Friends' },
] as const

export default function FeedPage() {
  const [sort, setSort] = useState<FeedSort>('new')
  return (
    <>
      <Composer />
      <div className="flex items-center justify-between gap-3">
        <Tabs tabs={TABS} value={sort} onChange={setSort} id="feed-sort" />
        {/* Desktop has the left panel; phones get here from the feed. */}
        <Link href="/communities" className="glass rounded-full px-4 py-1.5 font-ui text-xs font-medium text-sand/80 transition-transform press lg:hidden">
          Communities
        </Link>
      </div>
      <PostList sort={sort} empty={sort === 'friends' ? 'Add friends to see their posts here.' : 'Nothing yet. Be the first to post.'} />
    </>
  )
}
