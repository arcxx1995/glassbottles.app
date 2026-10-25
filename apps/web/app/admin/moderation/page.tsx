import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ModerationQueue from './ModerationQueue'

export const metadata: Metadata = {
  title: 'Moderation',
  robots: { index: false, follow: false },
}

// Admins only (migration 051 admins table). Everyone else gets a 404, so the
// page's existence isn't advertised. The RPCs re-check is_admin() regardless.
export default async function ModerationPage() {
  const { data: isAdmin } = await createClient().rpc('is_admin')
  if (isAdmin !== true) notFound()
  return <ModerationQueue />
}
