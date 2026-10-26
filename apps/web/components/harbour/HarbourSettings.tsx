'use client'

import { ChevronRight, Sailboat } from 'lucide-react'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { useBlockKayakMutation, useGetKayakBlocksQuery } from '@/store/api/bottleApi'

// Settings → Harbour: a way into your kayak's editor, and the people you've
// blocked there (056), each one tap from unblocked.
export default function HarbourSettings() {
  const { data: blocked = [] } = useGetKayakBlocksQuery()
  const [block, { isLoading }] = useBlockKayakMutation()

  return (
    <div className="flex flex-col gap-3">
      <TransitionLink
        href="/harbour?edit=1"
        className="press group flex items-center gap-4 rounded-3xl p-5 glass transition-[border-color,transform] duration-200 hover:border-seafoam/20"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-seafoam/10 text-seafoam">
          <Sailboat size={17} strokeWidth={1.5} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-ui text-sm font-medium text-sand">Your kayak</span>
          <span className="font-ui text-xs text-sand/45">Colours, bio, float or pull ashore</span>
        </span>
        <ChevronRight size={16} className="text-sand/30" aria-hidden="true" />
      </TransitionLink>

      {blocked.length > 0 && (
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
      )}
    </div>
  )
}
