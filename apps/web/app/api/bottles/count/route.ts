import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export interface BottleCountResponse {
  count: number
  date: string
}

// GET /api/bottles/count
// Returns the total number of bottles thrown today (all users, public ambient count).
// Requires auth to prevent unauthenticated scraping, but exposes no PII —
// just a raw count of today's non-stale bottles.
export async function GET(_req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD UTC

  // Use service role client so RLS does not restrict the count to the
  // authenticated user's own bottles. The endpoint returns a global ambient
  // count (no PII). Auth is still required (checked above on user client) to
  // prevent unauthenticated scraping.
  const service = createServiceClient()
  const { count, error } = await service
    .from('bottles')
    .select('id', { count: 'exact', head: true })
    .eq('day_key', today)
    .eq('is_stale', false)

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch count' }, { status: 500 })
  }

  return NextResponse.json({
    count: count ?? 0,
    date: today,
  } satisfies BottleCountResponse)
}
