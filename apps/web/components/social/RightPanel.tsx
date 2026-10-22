'use client'

import { TransitionLink as Link } from '@/components/ui/TransitionLink'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import OceanCounter from '@/components/shared/OceanCounter'
import {
  useAcceptFriendMutation, useGetCommunitiesQuery, useGetProfilesByIdsQuery,
  useRequestFriendMutation, useSuggestProfilesQuery,
} from '@/store/api/socialApi'
import { useMe } from './useMe'

export default function RightPanel() {
  const { uid, friendships } = useMe()
  const communities = useGetCommunitiesQuery()
  const incoming = friendships.filter((f) => f.status === 'pending' && f.addressee_id === uid)
  const requesters = useGetProfilesByIdsQuery(incoming.map((f) => f.requester_id))
  const [accept] = useAcceptFriendMutation()
  // ponytail: newest, not trending; real trending needs a ranked RPC.
  const trending = (communities.data ?? []).slice(0, 4)

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Link href="/sea">
        <Card material="tint" className="flex flex-col gap-2 p-4 transition-transform">
          <h2 className="font-display text-lg text-sand">The Sea</h2>
          <p className="font-ui text-xs text-sand/70">Throw a bottle. Catch a stranger&apos;s.</p>
          <OceanCounter />
        </Card>
      </Link>
      {incoming.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-ui text-xs font-semibold uppercase tracking-wider text-sand/40">Friend requests</h2>
          <ul className="flex flex-col gap-2">
            {(requesters.data ?? []).map((p) => (
              <li key={p.user_id} className="flex items-center gap-2">
                <Avatar handle={p.handle} src={p.avatar_url} size={28} />
                <span className="min-w-0 flex-1 truncate font-ui text-sm text-sand">@{p.handle}</span>
                <Button size="sm" onClick={() => uid && accept({ requester: p.user_id, me: uid })}>Accept</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <PeopleToMeet />
      {trending.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-ui text-xs font-semibold uppercase tracking-wider text-sand/40">New communities</h2>
          <ul className="flex flex-col gap-1">
            {trending.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.slug}`} className="press flex justify-between rounded-xl px-2 py-1.5 font-ui text-sm text-sand/70 hover:bg-white/5 hover:text-sand transition-[color,background-color,transform]">
                  <span className="truncate">c/{c.slug}</span>
                  <span className="text-xs text-sand/40">{c.members[0]?.count ?? 0}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export function PeopleToMeet() {
  const { uid, friendships } = useMe()
  const suggestions = useSuggestProfilesQuery(uid ?? '', { skip: !uid })
  const [request] = useRequestFriendMutation()
  const known = new Set(friendships.flatMap((f) => [f.requester_id, f.addressee_id]))
  const people = (suggestions.data ?? []).filter((p) => !known.has(p.user_id)).slice(0, 4)
  if (!people.length) return null
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-ui text-xs font-semibold uppercase tracking-wider text-sand/40">People to meet</h2>
      <ul className="flex flex-col gap-2">
        {people.map((p) => (
          <li key={p.user_id} className="flex items-center gap-2">
            <Avatar handle={p.handle} src={p.avatar_url} size={28} />
            <Link href={`/u/${p.handle}`} className="min-w-0 flex-1 truncate font-ui text-sm text-sand hover:underline">@{p.handle}</Link>
            <Button size="sm" variant="glass" onClick={() => uid && request({ from: uid, to: p.user_id })}>Add</Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
