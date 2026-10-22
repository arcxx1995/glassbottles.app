'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowBigDown, ArrowBigUp, Flag, MessageSquare, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import ConfirmButton from '@/components/ui/ConfirmButton'
import { TransitionLink as Link } from '@/components/ui/TransitionLink'
import { spring } from '@/components/ui/springs'
import {
  useAddCommentMutation, useDeletePostMutation, useGetCommentsQuery,
  useReportMutation, useVotePostMutation,
} from '@/store/api/socialApi'
import type { Post } from '@/types/social'
import { socialError, timeAgo } from './useMe'

function Comments({ postId, userId }: { postId: string; userId: string }) {
  const { data = [] } = useGetCommentsQuery(postId)
  const [add, { isLoading, error }] = useAddCommentMutation()
  const [text, setText] = useState('')
  return (
    <motion.div
      className="overflow-hidden"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={spring}
    >
    <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3">
      {data.map((c) => (
        <div key={c.id} className="flex gap-2">
          <Avatar handle={c.author.handle} src={c.author.avatar_url} size={28} />
          <div className="font-ui text-sm">
            <Link href={`/u/${c.author.handle}`} className="font-semibold text-seafoam hover:underline">@{c.author.handle}</Link>
            <span className="ml-2 text-xs text-sand/40">{timeAgo(c.created_at)}</span>
            <p className="text-sand/85">{c.body}</p>
          </div>
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim()) return
          try {
            await add({ postId, authorId: userId, body: text.trim() }).unwrap()
            setText('')
          } catch { /* shown below */ }
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment" maxLength={1000} aria-label="Write a comment" className="py-2" />
        <Button type="submit" size="sm" disabled={!text.trim() || isLoading}>Reply</Button>
      </form>
      {error && <p role="alert" className="font-ui text-xs text-coral">{socialError(error)}</p>}
    </div>
    </motion.div>
  )
}

export default function PostCard({ post, userId }: { post: Post; userId: string }) {
  const [open, setOpen] = useState(false)
  const [vote] = useVotePostMutation()
  const [del] = useDeletePostMutation()
  const [report, { isSuccess: reported }] = useReportMutation()
  const mine = post.my_vote[0]?.value ?? 0
  // Click the active arrow again to clear.
  const cast = (v: 1 | -1) => vote({ postId: post.id, userId, value: mine === v ? 0 : v, prev: mine })
  const held = post.screen === 'held'

  return (
    <Card material="flat" className="flex gap-3 p-4 md:p-5" role="article" aria-label={`Post by @${post.author.handle}`}>
      <div className="-my-1 flex w-9 shrink-0 flex-col items-center font-ui text-xs text-sand/60">
        <button onClick={() => cast(1)} aria-label="Upvote" aria-pressed={mine === 1}
          className={cn('press press-sm flex h-9 w-9 items-center justify-center rounded-full transition-[color,transform]', mine === 1 && 'text-seafoam')}>
          <ArrowBigUp size={22} />
        </button>
        <span className="tabular-nums">{post.score}</span>
        <button onClick={() => cast(-1)} aria-label="Downvote" aria-pressed={mine === -1}
          className={cn('press press-sm flex h-9 w-9 items-center justify-center rounded-full transition-[color,transform]', mine === -1 && 'text-coral')}>
          <ArrowBigDown size={22} />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 font-ui text-xs text-sand/50">
          <Avatar handle={post.author.handle} src={post.author.avatar_url} size={22} />
          <Link href={`/u/${post.author.handle}`} className="font-semibold text-seafoam hover:underline">@{post.author.handle}</Link>
          {post.community && <Link href={`/c/${post.community.slug}`} className="hover:underline">in c/{post.community.slug}</Link>}
          <span>{timeAgo(post.created_at)}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words font-ui text-sm text-sand/90">{post.body}</p>
        {held && (
          <p className="mt-2 rounded-2xl bg-coral/10 px-3 py-2 font-ui text-xs text-coral">
            Only you can see this. It was held by our safety check. You can delete it and post again.
          </p>
        )}
        <div className="-ml-2 mt-2 flex items-center gap-1 font-ui text-xs text-sand/55">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="press inline-flex min-h-9 items-center gap-1 rounded-full px-2 hover:text-sand transition-[color,transform]">
            <MessageSquare size={14} /> {post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}
          </button>
          {post.author_id === userId ? (
            <ConfirmButton onConfirm={() => del(post.id)} confirmLabel="Delete for good?" aria-label="Delete post">
              <Trash2 size={14} /> Delete
            </ConfirmButton>
          ) : (
            <ConfirmButton onConfirm={() => report({ reporterId: userId, type: 'post', targetId: post.id })}
              confirmLabel="Report this post?" disabled={reported}>
              <Flag size={14} /> {reported ? 'Reported' : 'Report'}
            </ConfirmButton>
          )}
        </div>
        <AnimatePresence initial={false}>
          {open && <Comments key="comments" postId={post.id} userId={userId} />}
        </AnimatePresence>
      </div>
    </Card>
  )
}
