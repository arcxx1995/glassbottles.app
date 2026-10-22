import BottleSkeleton from '@/components/shared/BottleSkeleton'

// Mirrors HomePage's frame (same padding, same header wordmark, same centered
// stage) so when this fallback briefly shows during navigation it reads as the
// home screen settling in — not a different screen flashing past.
export default function HomeLoading() {
  return (
    <div className="relative flex h-full flex-col items-center overflow-hidden px-5 pt-10 sm:pt-14">
      {/* Header — real wordmark, matches HomePage exactly */}
      <div className="relative z-10 mb-4 flex w-full items-center justify-between sm:mb-8">
        <h1 className="font-display text-2xl text-sand tracking-tight">
          glassbottles
        </h1>
      </div>

      {/* Stage ghost */}
      <div className="relative z-10 flex min-h-0 w-full max-w-md flex-1 flex-col items-center justify-center">
        <BottleSkeleton />
      </div>
    </div>
  )
}
