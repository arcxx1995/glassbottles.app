import BottleSkeleton from '@/components/shared/BottleSkeleton'

// Mirrors HomePage's frame (same padding, same centered stage; the wordmark is
// the shell's) so when this fallback briefly shows during navigation it reads
// as the home screen settling in — not a different screen flashing past.
export default function HomeLoading() {
  return (
    <div className="relative flex h-full flex-col items-center overflow-hidden px-5 pt-16 sm:pt-24">
      {/* Stage ghost */}
      <div className="relative z-10 flex min-h-0 w-full max-w-md flex-1 flex-col items-center justify-center">
        <BottleSkeleton />
      </div>
    </div>
  )
}
