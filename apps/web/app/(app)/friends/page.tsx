'use client'

import { TransitionLink as Link } from '@/components/ui/TransitionLink'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import ConfirmButton from '@/components/ui/ConfirmButton'
import { useMe } from '@/components/social/useMe'
import { PeopleToMeet } from '@/components/social/RightPanel'
import { useAcceptFriendMutation, useGetProfilesByIdsQuery, useRemoveFriendMutation } from '@/store/api/socialApi'

export default function FriendsPage() {
  const { uid, friendships } = useMe()
  const others = friendships.map((f) => (f.requester_id === uid ? f.addressee_id : f.requester_id))
  const { data: profiles = [] } = useGetProfilesByIdsQuery(others)
  const [accept] = useAcceptFriendMutation()
  const [remove] = useRemoveFriendMutation()
  if (!uid) return null

  const rows = friendships.map((f) => {
    const otherId = f.requester_id === uid ? f.addressee_id : f.requester_id
    return { f, p: profiles.find((x) => x.user_id === otherId), otherId }
  })
  const section = (title: string, list: typeof rows, action: (r: (typeof rows)[number]) => React.ReactNode) =>
    list.length > 0 && (
      <Card>
        <h2 className="mb-3 font-ui text-xs font-semibold uppercase tracking-wider text-sand/40">{title}</h2>
        <ul className="flex flex-col gap-3">
          {list.map((r) => r.p && (
            <li key={r.otherId} className="flex items-center gap-3">
              <Avatar handle={r.p.handle} src={r.p.avatar_url} size={36} />
              <Link href={`/u/${r.p.handle}`} className="min-w-0 flex-1 truncate font-ui text-sm text-sand hover:underline">@{r.p.handle}</Link>
              {action(r)}
            </li>
          ))}
        </ul>
      </Card>
    )

  const incoming = rows.filter((r) => r.f.status === 'pending' && r.f.addressee_id === uid)
  const sent = rows.filter((r) => r.f.status === 'pending' && r.f.requester_id === uid)
  const friends = rows.filter((r) => r.f.status === 'accepted')
  return (
    <>
      <h1 className="font-display text-title text-sand">Friends</h1>
      {section('Requests', incoming, (r) => <Button size="sm" onClick={() => accept({ requester: r.otherId, me: uid })}>Accept</Button>)}
      {section('Your friends', friends, (r) => <ConfirmButton onConfirm={() => remove({ a: uid, b: r.otherId })} confirmLabel="Remove?" className="px-3 font-ui text-xs font-semibold text-sand/70">Remove</ConfirmButton>)}
      {section('Sent', sent, (r) => <Button size="sm" variant="ghost" onClick={() => remove({ a: uid, b: r.otherId })}>Cancel</Button>)}
      {rows.length === 0 && <Card className="text-center font-ui text-sm text-sand/50">No friends yet. Here are some people to meet.</Card>}
      {/* The right panel (with suggestions) only shows on xl. */}
      <div className="xl:hidden"><PeopleToMeet /></div>
    </>
  )
}
