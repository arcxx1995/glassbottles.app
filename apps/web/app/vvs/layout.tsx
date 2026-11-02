import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import VvsNav from './VvsNav'

export const metadata: Metadata = {
  title: 'vvs',
  robots: { index: false, follow: false },
}

// The admin console (065). Non-admins get a plain 404, so its existence isn't
// advertised; middleware also 404s it on any other host. Every RPC re-checks
// is_admin() regardless, so this is the door, not the lock.
export default async function VvsLayout({ children }: { children: React.ReactNode }) {
  const { data: isAdmin } = await createClient().rpc('is_admin')
  if (isAdmin !== true) notFound()
  return (
    <div className="min-h-[100svh] overflow-y-auto bg-ocean-deep text-sand">
      <VvsNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-16 pt-5">{children}</main>
    </div>
  )
}
