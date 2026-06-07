/**
 * BottleSkeleton — placeholder rendered while bottle status loads.
 * Matches BottleCanvas dimensions exactly (160×240) to prevent layout shift.
 */
export default function BottleSkeleton() {
  return (
    <div
      className="flex flex-col items-center gap-8 w-full"
      role="status"
      aria-label="Loading bottle"
    >
      {/* Bottle ghost — same 160×240 as BottleCanvas */}
      <div
        className="rounded-[48px] bg-ocean-mid animate-pulse"
        style={{ width: '160px', height: '240px' }}
      />

      {/* Text ghost */}
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-36 bg-ocean-mid rounded-xl animate-pulse" />
        <div className="h-4 w-52 bg-ocean-mid/70 rounded-xl animate-pulse" />
        <div className="mt-3 h-14 w-44 bg-ocean-mid rounded-2xl animate-pulse" />
      </div>
    </div>
  )
}
