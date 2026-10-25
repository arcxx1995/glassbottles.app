import Link from 'next/link'
import { BottleSVG } from '@/components/bottle/ThrowAnimation'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[100svh] gap-6 px-5 text-center bg-ocean-deep">
      <span
        className="inline-block select-none"
        role="img"
        aria-label="glass bottle"
        style={{ ['--gb-bob' as string]: '-6px', animation: 'gb-bob 3.2s ease-in-out infinite' }}
      >
        <BottleSVG width={48} height={72} glowing />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-title text-sand">Lost at sea</h2>
        <p className="font-ui text-sm text-sand/40 max-w-[220px] mx-auto leading-relaxed">
          That page drifted away. Maybe it&apos;s in someone&apos;s inbox.
        </p>
      </div>
      <Link
        href="/sea"
        className="press px-6 py-2.5 rounded-full bg-seafoam/10 font-ui text-sm font-medium text-seafoam hover:bg-seafoam/20 transition-[background-color,transform]"
      >
        Back to shore →
      </Link>
    </div>
  )
}
