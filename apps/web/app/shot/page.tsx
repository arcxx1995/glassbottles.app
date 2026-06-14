'use client'

// Temporary screenshot route — sky + sea waves only (no ships/clouds/bottles),
// with a frozen lightning flash washing the sea (the "thunder instant").
import SailingSea from '@/components/bottle/SailingSea'

export default function ShotPage() {
  return (
    <main className="min-h-screen">
      <SailingSea bottles={[]} backdropOnly thunder />
    </main>
  )
}
