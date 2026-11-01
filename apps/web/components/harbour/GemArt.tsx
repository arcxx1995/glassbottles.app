'use client'

import { useMemo } from 'react'
import { drawGem } from '@/lib/gems/engine'
import { cn } from '@/lib/utils'

// drawGem emits only numbers and its own constants (see lib/gems/engine.ts).
export default function GemArt({ seed, className }: { seed: number; className?: string }) {
  const html = useMemo(() => drawGem(seed), [seed])
  return (
    <div aria-hidden="true" className={cn('[&>svg]:block [&>svg]:h-full [&>svg]:w-full', className)} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
