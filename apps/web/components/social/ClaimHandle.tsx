'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { socialApi, useClaimHandleMutation } from '@/store/api/socialApi'
import { useAppDispatch } from '@/store'
import { socialError } from './useMe'

const HANDLE_RE = /^[a-z0-9_]{3,20}$/

/** First visit to the social side: pick a pseudonymous handle. No real names. */
export default function ClaimHandle({ userId }: { userId: string }) {
  const [handle, setHandle] = useState('')
  const [claim, { isLoading, error }] = useClaimHandleMutation()
  const dispatch = useAppDispatch()
  const clean = handle.toLowerCase()
  const valid = HANDLE_RE.test(clean)

  return (
    <Card material="strong" className="mx-auto mt-10 flex max-w-sm flex-col gap-4">
      <h1 className="font-display text-title text-sand">Pick your handle</h1>
      <p className="font-ui text-sm text-sand/60">
        This is how people see you here. No real names, and it is never linked to your bottles.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          // A duplicate on the primary key means this account already has a
          // handle (another tab): refetching Me drops the gate.
          claim({ userId, handle: clean }).unwrap().catch((e) => {
            if (!String(e?.error).includes('social_profiles_handle_key')) dispatch(socialApi.util.invalidateTags(['Me']))
          })
        }}
      >
        <Input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="e.g. tidewalker"
          maxLength={20}
          autoFocus
          aria-label="Handle"
        />
        <p className="px-1 font-ui text-xs text-sand/40">3 to 20 letters, numbers or underscores.</p>
        {error && <p role="alert" className="px-1 font-ui text-xs text-coral">{socialError(error, 'That handle is taken.')}</p>}
        <Button type="submit" disabled={!valid || isLoading}>Claim handle</Button>
      </form>
    </Card>
  )
}
