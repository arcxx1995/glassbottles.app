'use client'

import { memo, useRef } from 'react'
import { Bookmark, Hourglass } from 'lucide-react'
import { BottleSVG } from '@/components/bottle/ThrowAnimation'
import { NOTE_PAPER, bottleLook, type AtelierPiece, type BottleStyle } from '@/lib/dressing'
import { cn } from '@/lib/utils'

export interface ShelfItem {
  id: string
  /** When it came ashore: orders the shelf and fills the date tag. */
  at: string
  unread: boolean
  kept: boolean
  /** A letter to yourself (047) rather than a stranger's bottle. */
  letter: boolean
  style: BottleStyle | null | undefined
}

// One bottle on its plank. A shelf can hold hundreds, so nothing here runs
// Motion: the wiggle is a CSS loop, offset per bottle so new ones stir in turn.
function ShelfBottle({
  item,
  pieces,
  isKeeper,
  arriving,
  lifted,
  onOpen,
}: {
  item: ShelfItem
  pieces: AtelierPiece[] | undefined
  isKeeper: boolean
  /** The newest unread bottle: the banner's bottle flies into this one. */
  arriving: boolean
  /** Off the plank: it's in the dialog right now. */
  lifted: boolean
  onOpen: (id: string, lift: HTMLElement) => void
}) {
  const liftRef = useRef<HTMLSpanElement>(null)
  const look = bottleLook(item, pieces, isKeeper)
  const date = new Date(item.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const what = item.letter ? 'Letter to yourself' : 'Bottle'
  const state = item.unread ? 'unopened' : 'opened'

  return (
    <div className="shelf-cell">
      <button
        type="button"
        onClick={() => liftRef.current && onOpen(item.id, liftRef.current)}
        aria-label={`${what}, ${state}, ${date}${item.kept ? ', kept' : ''}`}
        className="press flex h-full w-full flex-col items-center justify-end rounded-xl pb-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-seafoam"
      >
        <span
          className={cn('relative block', lifted && 'invisible')}
          style={arriving ? { viewTransitionName: 'arriving-bottle' } : undefined}
        >
          <span
            ref={liftRef}
            className={cn('block origin-bottom', item.unread && 'gb-wiggle')}
            style={item.unread ? { animationDelay: `-${wiggleOffset(item.id)}s` } : undefined}
          >
            <BottleSVG width={56} height={84} corked={item.unread} glowing={item.unread} look={look} />
          </span>
          {!item.unread && (
            <>
              <span
                aria-hidden
                className="absolute bottom-0 -left-2.5 h-2 w-2.5 -rotate-12 rounded-[2px]"
                style={{ background: look.wax ?? '#C4A882' }}
              />
              <span
                aria-hidden
                className="absolute bottom-0 -right-3 h-2.5 w-4 rotate-6 rounded-full border border-sand/50"
                style={{ background: NOTE_PAPER }}
              />
            </>
          )}
        </span>
        <span className="mt-0.5 flex h-5 items-center gap-1 rounded-[3px] bg-sand/90 px-1.5 font-mono text-[10px] text-ocean-deep shadow-card -rotate-1">
          {item.letter && <Hourglass size={9} strokeWidth={2} aria-hidden />}
          {item.kept && <Bookmark size={9} strokeWidth={2} fill="currentColor" aria-hidden />}
          {date}
        </span>
      </button>
    </div>
  )
}

function wiggleOffset(id: string) {
  let n = 0
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) % 55
  return n / 10
}

export default memo(ShelfBottle)
