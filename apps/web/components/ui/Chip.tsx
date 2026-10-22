import { cn } from '@/lib/utils'

export function Chip({ className, active, ...props }: React.HTMLAttributes<HTMLSpanElement> & { active?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 font-ui text-xs font-medium',
        // Chips live on cards: fills, not another frosted layer.
        active ? 'border border-seafoam/45 bg-seafoam/20 text-sand' : 'glass-fill text-sand/75',
        className,
      )}
      {...props}
    />
  )
}
