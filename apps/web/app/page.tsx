import type { PublicStats } from '@/store/api/bottleApi'
import LandingPage from './landing-page'

// Fetch public stats server-side so the counter section has real numbers on
// first paint — no client-side loading flash or '—' placeholder. The result
// is cached by Next.js for 60 s (revalidate), so repeat visitors within that
// window pay zero Supabase compute. RTK Query in LandingPage still re-fetches
// client-side and switches to live data once it resolves.
async function fetchPublicStats(): Promise<PublicStats> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/get_public_stats`,
      {
        method: 'POST',
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        next: { revalidate: 60 },
      },
    )
    if (!res.ok) return { adriftCount: 0, totalCount: 0 }
    const data: unknown = await res.json()
    const row = Array.isArray(data) ? data[0] : data
    return {
      adriftCount: (row as { adrift_count?: number })?.adrift_count ?? 0,
      totalCount: (row as { total_count?: number })?.total_count ?? 0,
    }
  } catch {
    return { adriftCount: 0, totalCount: 0 }
  }
}

export default async function Page() {
  const initialStats = await fetchPublicStats()
  return <LandingPage initialStats={initialStats} />
}
