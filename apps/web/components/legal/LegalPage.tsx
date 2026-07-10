import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

// Shared chrome for /privacy and /terms: back link, centered column, and the
// typographic scale both legal docs use. Server component — pure prose.
export default function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string
  lastUpdated: string
  children: React.ReactNode
}) {
  return (
    <main className="relative z-10 min-h-screen px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-ui text-sm text-sand/45
                     hover:text-seafoam transition-colors mb-10"
        >
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
          Back to glassbottles
        </Link>

        <h1 className="font-display text-3xl md:text-4xl text-sand mb-2">{title}</h1>
        <p className="font-ui text-sm text-sand/40 mb-10">Last updated: {lastUpdated}</p>

        <div className="flex flex-col gap-6 font-ui text-[15px] leading-[1.75] text-sand/70">
          {children}
        </div>
      </div>
    </main>
  )
}

// Section heading used inside legal docs.
export function LegalH2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-xl text-sand mt-4 mb-1">{children}</h2>
  )
}
