'use client'

import { useState } from 'react'
import { useUnblockAllKayaksMutation } from '@/store/api/bottleApi'

// Settings → Kayaks you've blocked (063). Owners have no names to list, so
// undoing is all or nothing.
export default function HarbourSettings() {
  const [unblock, { isLoading }] = useUnblockAllKayaksMutation()
  const [done, setDone] = useState<number | null>(null)
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="font-ui text-sm text-sand/70">
        {done === null
          ? 'Kayaks from people you’ve blocked stay away from your harbour.'
          : done === 0
            ? 'You haven’t blocked anyone.'
            : `Unblocked ${done}.`}
      </span>
      <button
        type="button"
        disabled={isLoading}
        onClick={async () => setDone(await unblock().unwrap())}
        className="press shrink-0 rounded-full bg-white/10 px-3 py-1 font-ui text-xs text-sand/80 disabled:opacity-50"
      >
        Unblock all
      </button>
    </div>
  )
}
