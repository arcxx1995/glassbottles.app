'use client'

import { TransitionLink as Link } from '@/components/ui/TransitionLink'
import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import ConfirmButton from '@/components/ui/ConfirmButton'
import {
  useAddScrapMutation, useApproveScrapMutation, useDeleteScrapMutation, useGetScrapsQuery,
} from '@/store/api/socialApi'
import { socialError, timeAgo } from './useMe'

const KINDS = [
  { value: 'scrap', label: 'Scraps' },
  { value: 'testimonial', label: 'Testimonials' },
] as const

/** Orkut-style wall: scraps post instantly, testimonials wait for the owner. */
export default function Wall({ wallId, meId, isOwner }: { wallId: string; meId: string; isOwner: boolean }) {
  const [kind, setKind] = useState<'scrap' | 'testimonial'>('scrap')
  const [text, setText] = useState('')
  const { data = [] } = useGetScrapsQuery(wallId)
  const [add, { isLoading, error }] = useAddScrapMutation()
  const [approve] = useApproveScrapMutation()
  const [del] = useDeleteScrapMutation()
  const rows = data.filter((s) => s.kind === kind)

  return (
    <div className="flex flex-col gap-3">
      <Tabs tabs={KINDS} value={kind} onChange={setKind} id="wall-kind" className="self-start" />
      {!isOwner && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!text.trim()) return
            try {
              await add({ wallId, authorId: meId, body: text.trim(), kind }).unwrap()
              setText('')
            } catch { /* shown below */ }
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
            placeholder={kind === 'scrap' ? 'Leave a scrap' : 'Write a testimonial (they approve it first)'}
            aria-label={kind === 'scrap' ? 'Leave a scrap' : 'Write a testimonial'} />
          <Button type="submit" disabled={!text.trim() || isLoading}>Send</Button>
        </form>
      )}
      {error && <p role="alert" className="px-1 font-ui text-xs text-coral">{socialError(error)}</p>}
      {rows.length === 0 && <Card className="text-center font-ui text-sm text-sand/50">Nothing here yet.</Card>}
      {rows.map((s) => (
        <Card key={s.id} material="flat" className="flex gap-3 p-4">
          <Avatar handle={s.author.handle} src={s.author.avatar_url} size={32} />
          <div className="min-w-0 flex-1 font-ui text-sm">
            <Link href={`/u/${s.author.handle}`} className="font-semibold text-seafoam hover:underline">@{s.author.handle}</Link>
            <span className="ml-2 text-xs text-sand/40">{timeAgo(s.created_at)}</span>
            {!s.approved && <span className="ml-2 text-xs text-coral">awaiting approval</span>}
            {s.screen === 'held' && <span className="ml-2 text-xs text-coral">only you can see this (held by our safety check)</span>}
            <p className="mt-1 whitespace-pre-wrap break-words text-sand/85">{s.body}</p>
          </div>
          <div className="flex shrink-0 items-start gap-1">
            {isOwner && !s.approved && (
              <button onClick={() => approve(s.id)} aria-label="Approve" className="press flex h-9 w-9 items-center justify-center rounded-full text-seafoam hover:bg-white/10 transition-[background-color,transform]"><Check size={16} /></button>
            )}
            {(isOwner || s.author_id === meId) && (
              <ConfirmButton onConfirm={() => del(s.id)} confirmLabel="Delete?" aria-label="Delete" className="justify-center font-ui text-xs text-sand/55"><Trash2 size={16} /></ConfirmButton>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
