import { cn } from '@/lib/utils'

// Pseudonymous: shows image if given, else the first letter of the handle.
export function Avatar({ handle, src, size = 40, className }: { handle: string; src?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={cn('glass-fill inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-ui font-semibold text-seafoam', className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : handle.slice(0, 1).toUpperCase()}
    </span>
  )
}
