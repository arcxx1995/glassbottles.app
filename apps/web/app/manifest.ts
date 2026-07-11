import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'glassbottles',
    short_name: 'glassbottles',
    description: 'One bottle. One stranger. Every day.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0A1628',
    theme_color: '#0A1628',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon/192',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon/512',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
