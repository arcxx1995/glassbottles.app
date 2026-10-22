'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { INPUT_CLASS } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { useUpdateProfileMutation } from '@/store/api/socialApi'
import { socialError, useMe } from './useMe'

/** Settings → Social: your handle (permanent) and bio. */
export default function BioCard() {
  const { me } = useMe()
  const [bio, setBio] = useState('')
  const [save, { isLoading, isSuccess, error, reset }] = useUpdateProfileMutation()
  useEffect(() => { setBio(me?.bio ?? '') }, [me?.bio])
  if (!me) {
    return <Card className="p-5 font-ui text-sm text-sand/60">Pick a handle on the feed to set up your profile.</Card>
  }
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="font-ui text-sm text-sand">@{me.handle}</p>
      <textarea
        value={bio}
        onChange={(e) => { setBio(e.target.value); reset() }}
        maxLength={280}
        rows={3}
        placeholder="A line or two about you"
        aria-label="Bio"
        className={cn(INPUT_CLASS, 'resize-none')}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-sand/45">{bio.length}/280</span>
        <Button size="sm" disabled={isLoading || bio === (me.bio ?? '')}
          onClick={() => save({ userId: me.user_id, bio: bio.trim() })}>
          {isSuccess ? 'Saved' : 'Save bio'}
        </Button>
      </div>
      {error && <p role="alert" className="font-ui text-xs text-coral">{socialError(error)}</p>}
    </Card>
  )
}
