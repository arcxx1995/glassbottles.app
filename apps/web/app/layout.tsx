import type { Metadata, Viewport } from 'next'
import { Playfair_Display, DM_Sans, JetBrains_Mono } from 'next/font/google'
import { ReduxProvider } from '@/components/providers/ReduxProvider'
import AuthProvider from '@/components/providers/AuthProvider'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-display',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ui',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-mono',
})

const SITE_URL = 'https://glassbottles.app'
const TITLE = 'glassbottles — anonymous message in a bottle'
const DESCRIPTION =
  'The anonymous message in a bottle app. Write one honest message a day, ' +
  'throw it into a digital sea, and a stranger’s bottle may wash up for you. Free.'

export const metadata: Metadata = {
  // metadataBase makes every relative OG/icon URL absolute — required for
  // social link previews and correct canonical resolution.
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · glassbottles',
  },
  description: DESCRIPTION,
  applicationName: 'glassbottles',
  authors: [{ name: 'glassbottles', url: SITE_URL }],
  keywords: [
    'message in a bottle app',
    'anonymous message in a bottle',
    'send a message to a stranger',
    'digital message in a bottle online',
    'anonymous notes to strangers',
    'random message exchange app',
  ],
  // icons come from app/icon.tsx + app/apple-icon.tsx (file convention)
  appleWebApp: {
    capable: true,
    title: 'glassbottles',
    statusBarStyle: 'black-translucent',
  },
  manifest: '/manifest.webmanifest',
  alternates: { canonical: '/' },
  // og:image / twitter:image come from app/opengraph-image.png (file
  // convention — takes precedence over anything listed here).
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'glassbottles',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

// Mobile-first viewport: cover the notch (viewport-fit), tint the browser chrome
// to the ocean, and let the layout shrink when the keyboard opens so the throw
// CTA stays reachable. Zoom is left enabled for accessibility.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A1628',
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-ocean-deep text-sand font-ui antialiased">
        <ReduxProvider>
          <AuthProvider>{children}</AuthProvider>
        </ReduxProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
