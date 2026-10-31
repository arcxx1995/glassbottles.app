'use client'

import Sheet from '@/components/ui/Sheet'
import ReceivedBottle from '@/components/bottle/ReceivedBottle'
import FutureBottleCard from '@/components/bottle/FutureBottleCard'
import type { FutureBottles } from '@/store/api/bottleApi'
import type { Bottle } from '@/types'

// A bottle off the shelf. Rendered without AnimatePresence on purpose: closing
// is a view transition, and an exiting copy would double the bottle's name.
export default function BottleDialog({
  bottle,
  letter,
  onClose,
  onReported,
}: {
  bottle?: Bottle
  letter?: FutureBottles['arrived'][number]
  onClose: () => void
  onReported: (ok: boolean) => void
}) {
  return (
    <Sheet centered className="px-3" title={letter ? 'From you' : 'A bottle washed ashore'} onClose={onClose}>
      {letter && <FutureBottleCard bottle={letter} />}
      {bottle && <ReceivedBottle bottle={bottle} onReported={onReported} />}
    </Sheet>
  )
}
