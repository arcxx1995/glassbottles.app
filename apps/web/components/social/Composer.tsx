'use client'

import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useCreatePostMutation, useGetMyCommunitiesQuery } from '@/store/api/socialApi'
import { socialError, useMe } from './useMe'

export default function Composer({ communityId }: { communityId?: string }) {
  const { uid, me } = useMe()
  const [body, setBody] = useState('')
  // Only used on the main feed; a community page always posts to itself.
  const [target, setTarget] = useState('')
  const [create, { isLoading, error, reset }] = useCreatePostMutation()
  const { data: options = [] } = useGetMyCommunitiesQuery(uid ?? '', { skip: !uid || !!communityId })
  if (!me) return null

  return (
    // The card itself is the field: it lights up when you're writing in it.
    <Card className="flex gap-3 transition-[border-color,box-shadow] duration-200 focus-within:border-seafoam/40 focus-within:shadow-[0_0_0_3px_rgba(78,205,196,0.12)]">
      <Avatar handle={me.handle} src={me.avatar_url} />
      <form
        className="flex flex-1 flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!body.trim()) return
          try {
            await create({ authorId: me.user_id, body: body.trim(), communityId: communityId ?? (target || null) }).unwrap()
            setBody('')
          } catch { /* shown below */ }
        }}
      >
        <textarea
          value={body}
          onChange={(e) => { setBody(e.target.value); if (error) reset() }}
          maxLength={2000}
          rows={2}
          placeholder={`What's on your mind, ${me.handle}?`}
          aria-label="Write a post"
          className="w-full resize-none bg-transparent font-ui text-sm text-sand outline-none placeholder:text-sand/45"
        />
        {error && <p role="alert" className="font-ui text-xs text-coral">{socialError(error)}</p>}
        <div className="flex items-center justify-between gap-2">
          {communityId ? <span /> : (
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Post to"
              className="glass-fill h-9 rounded-full px-3 font-ui text-xs text-sand/80 outline-none focus-visible:ring-2 focus-visible:ring-seafoam/60"
            >
              <option value="" className="bg-ocean-deep">Everyone</option>
              {options.map((c) => <option key={c.id} value={c.id} className="bg-ocean-deep">c/{c.slug}</option>)}
            </select>
          )}
          <Button type="submit" size="sm" disabled={!body.trim() || isLoading}>Post</Button>
        </div>
      </form>
    </Card>
  )
}
