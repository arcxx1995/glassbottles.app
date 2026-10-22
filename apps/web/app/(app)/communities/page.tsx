'use client'

import { TransitionLink as Link } from '@/components/ui/TransitionLink'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { socialError, useMe } from '@/components/social/useMe'
import { useCreateCommunityMutation, useGetCommunitiesQuery } from '@/store/api/socialApi'

const SLUG_RE = /^[a-z0-9_-]{3,30}$/

export default function CommunitiesPage() {
  const { uid } = useMe()
  const { data = [] } = useGetCommunitiesQuery()
  const [create, { isLoading, error }] = useCreateCommunityMutation()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const valid = name.trim().length >= 2 && SLUG_RE.test(slug.toLowerCase())
  if (!uid) return null

  return (
    <>
      <h1 className="font-display text-title text-sand">Communities</h1>
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!valid) return
            try {
              await create({ slug, name: name.trim(), description: description.trim(), userId: uid }).unwrap()
              setName(''); setSlug(''); setDescription('')
            } catch { /* shown below */ }
          }}
        >
          <h2 className="font-ui text-sm font-semibold text-sand">Start a community</h2>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={60} aria-label="Community name" />
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="url-name (c/url-name)" maxLength={30} aria-label="Community URL name" />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it about?" maxLength={500} aria-label="Community description" />
          {error && <p role="alert" className="px-1 font-ui text-xs text-coral">{socialError(error, 'That URL name is taken.')}</p>}
          <Button type="submit" disabled={!valid || isLoading} className="self-end">Create</Button>
        </form>
      </Card>
      {data.map((c) => (
        <Link key={c.id} href={`/c/${c.slug}`} className="press block rounded-3xl">
          <Card className="p-4 transition-[border-color] hover:border-white/20">
            <p className="font-ui text-sm font-semibold text-sand">{c.name} <span className="font-normal text-sand/40">c/{c.slug}</span></p>
            {c.description && <p className="mt-1 font-ui text-sm text-sand/60">{c.description}</p>}
            <p className="mt-2 font-ui text-xs text-sand/40">{c.members[0]?.count ?? 0} members</p>
          </Card>
        </Link>
      ))}
    </>
  )
}
