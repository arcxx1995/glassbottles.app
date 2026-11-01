'use client'

import { useMemo } from 'react'
import { drawKayak, hullPath } from '@/lib/kayakArt'
import type { KayakLook } from '@/lib/kayakLook'
import { cn } from '@/lib/utils'

// drawKayak only ever emits its own constants (see lib/kayakArt.ts), so
// injecting it is safe, and one SVG string stays cheap across a page of them.
export default function KayakArt({
  look,
  aboard = 0,
  className,
}: {
  look: Partial<KayakLook> | null | undefined
  aboard?: number
  className?: string
}) {
  const html = useMemo(() => drawKayak(look, { aboard }), [look, aboard])
  return (
    <div aria-hidden="true" className={cn('[&>svg]:block [&>svg]:h-full [&>svg]:w-full', className)} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

/** The hull's soft shadow on the seabed, cast down-right through the water. */
export function KayakShadow({ look, className }: { look: Partial<KayakLook> | null | undefined; className?: string }) {
  return (
    <svg viewBox="-30 -8 260 316" className={className} aria-hidden="true">
      <path d={hullPath(look)} fill="#00222E" fillOpacity="0.42" />
    </svg>
  )
}
