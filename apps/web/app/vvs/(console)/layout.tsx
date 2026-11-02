import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import VvsNav from './VvsNav'

export const metadata: Metadata = {
  title: 'vvs',
  robots: { index: false, follow: false },
}

// The admin console (065). Middleware signs out anyone who isn't an admin and
// sends them to the login screen, and 404s /vvs on any other host. This check and
// every RPC's is_admin() are there regardless, so no single layer is the lock.
export default async function VvsLayout({ children }: { children: React.ReactNode }) {
  const { data: isAdmin } = await createClient().rpc('is_admin')
  if (isAdmin !== true) notFound()
  return (
    <div className="min-h-[100svh] bg-ocean-deep text-sand">
      <VvsNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-16 pt-5">{children}</main>
    </div>
  )
}
