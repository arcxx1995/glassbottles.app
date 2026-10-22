import { cn } from '@/lib/utils'

type Material = 'glass' | 'strong' | 'tint' | 'flat'
const MATERIAL: Record<Material, string> = {
  glass: 'glass',
  strong: 'glass-strong',
  tint: 'glass-tint',
  // No backdrop-filter: for repeated content (feed posts) where a blur layer
  // per card over the animated sea costs frames.
  flat: 'glass-flat',
}

export function Card({
  className,
  material = 'glass',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { material?: Material }) {
  return <div className={cn(MATERIAL[material], 'rounded-3xl p-5 md:p-6', className)} {...props} />
}
