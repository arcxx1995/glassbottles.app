import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-5 text-center bg-ocean-deep">
      <span className="text-6xl select-none" role="img" aria-label="glass bottle">
        🫙
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl text-sand">Lost at sea</h2>
        <p className="font-ui text-sm text-sand/40 max-w-[220px] mx-auto leading-relaxed">
          That page drifted away. Maybe it&apos;s in someone&apos;s inbox.
        </p>
      </div>
      <Link
        href="/home"
        className="font-ui text-sm text-seafoam hover:text-seafoam/70 transition-colors"
      >
        Back to shore →
      </Link>
    </div>
  )
}
