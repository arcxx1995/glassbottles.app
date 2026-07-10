import { MetadataRoute } from 'next'

const SITE_URL = 'https://glassbottles.app'

// Public, indexable routes only — auth-gated screens (/home, /inbox,
// /settings) and utility pages (password reset) stay out.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${SITE_URL}/sign-up`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/sign-in`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
  ]
}
