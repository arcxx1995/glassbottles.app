import { notFound } from 'next/navigation'

// /preview is a dev-only visual regression page (mock state, no auth). It has
// no business being reachable on the production site.
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return children
}
