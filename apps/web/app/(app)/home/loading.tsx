import BottleSkeleton from '@/components/shared/BottleSkeleton'

export default function HomeLoading() {
  return (
    <div className="flex flex-col items-center min-h-screen pt-14 px-5">
      {/* Header ghost */}
      <div className="w-full max-w-md flex items-center justify-between mb-10">
        <div className="h-7 w-32 bg-ocean-mid rounded-xl animate-pulse" />
      </div>

      {/* Bottle + CTA ghost */}
      <div className="w-full max-w-md flex flex-col items-center gap-8 flex-1">
        <BottleSkeleton />
      </div>
    </div>
  )
}
