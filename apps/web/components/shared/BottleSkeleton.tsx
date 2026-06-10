/**
 * BottleSkeleton — placeholder rendered while bottle status loads.
 *
 * Dimensions match BottleCanvas exactly (160×240) to prevent layout shift.
 * Uses the `skeleton` CSS utility (globals.css) which combines:
 *   - skeleton-pulse animation (opacity 1→0.4→1, 1.8s)
 *   - shimmer sweep overlay (translateX -100%→100%, 1.6s)
 *
 * Design note (Souryadeep): The bottle ghost uses rounded-[48px] to approximate
 * the bottle body's wide-bottom silhouette. Not pixel-perfect — intentionally
 * abstract so it reads as "loading" rather than "broken bottle".
 */
export default function BottleSkeleton() {
  return (
    <div
      className="flex flex-col items-center gap-8 w-full"
      role="status"
      aria-label="Loading bottle"
    >
      {/* Bottle ghost — 160×240 matches BottleCanvas */}
      <div
        className="skeleton rounded-[48px]"
        style={{ width: '160px', height: '240px' }}
      />

      {/* Text ghost */}
      <div className="flex flex-col items-center gap-3">
        <div className="skeleton h-6 w-36 rounded-xl" />
        <div className="skeleton h-4 w-52 rounded-xl" style={{ opacity: 0.7 }} />
        {/* CTA ghost */}
        <div className="skeleton mt-3 h-14 w-44 rounded-2xl" />
      </div>
    </div>
  )
}
