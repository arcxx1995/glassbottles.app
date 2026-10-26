'use client'

import { useBlockKayakMutation } from '@/store/api/bottleApi'

// Settings → Blocked in the Harbour (056): each handle one tap from unblocked.
export default function HarbourSettings({ blocked }: { blocked: string[] }) {
  const [block, { isLoading }] = useBlockKayakMutation()
  return (
    <div className="glass inset-group">
      {blocked.map((h) => (
        <div key={h} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="font-ui text-sm text-sand/80">@{h}</span>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => block({ handle: h, block: false })}
            className="press rounded-full bg-white/10 px-3 py-1 font-ui text-xs text-sand/80 disabled:opacity-50"
          >
            Unblock
          </button>
        </div>
      ))}
    </div>
  )
}
