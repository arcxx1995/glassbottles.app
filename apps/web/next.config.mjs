/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  // v2 moved the bottle screen to /sea. Old bookmarks, PWA tabs and pushes
  // sent before the push-notify redeploy still say /home. Temporary (307) so
  // browsers don't cache it forever if /home is ever reused.
  async redirects() {
    return [{ source: '/home', destination: '/sea', permanent: false }]
  },
}

export default nextConfig
