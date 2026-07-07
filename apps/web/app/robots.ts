import { MetadataRoute } from 'next'

const SITE_URL = 'https://glassbottles.app'

export default function robots(): MetadataRoute.Robots {
  return {
    // Single permissive rule: AI crawlers (GPTBot, ClaudeBot, PerplexityBot,
    // Google-Extended) are deliberately NOT blocked — being readable by answer
    // engines is a discoverability feature for this app.
    rules: {
      userAgent: '*',
      allow: '/',
      // Auth-gated app screens, auth utility pages, API, and internal
      // screenshot/preview routes are not content — keep them out of the index.
      disallow: [
        '/api/',
        '/auth/',
        '/shot/',
        '/preview/',
        '/home',
        '/inbox',
        '/settings',
        '/forgot-password',
        '/reset-password',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
