import type { PublicStats } from '@/store/api/bottleApi'
import LandingPage from './landing-page'
import { FAQ_ITEMS } from './faq-data'

const SITE_URL = 'https://glassbottles.app'

// Structured data for rich results + AI answer engines. One @graph keeps
// WebSite / WebApplication / FAQPage in a single script tag. FAQ text comes
// from faq-data.ts so it always matches the visible FAQ section.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'glassbottles',
      alternateName: 'Glass Bottles',
      description: 'Anonymous message in a bottle app — one message, one stranger, every day.',
    },
    {
      '@type': 'WebApplication',
      '@id': `${SITE_URL}/#app`,
      name: 'glassbottles',
      url: SITE_URL,
      description:
        'Write one anonymous message a day, throw it into a digital sea, and receive a stranger’s bottle in return. No profiles, no replies, no feed.',
      applicationCategory: 'SocialNetworkingApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#faq`,
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  ],
}

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
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <LandingPage initialStats={initialStats} />
    </>
  )
}
