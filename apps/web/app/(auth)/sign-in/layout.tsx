import type { Metadata } from 'next'

// page.tsx is a client component, so route metadata lives here.
export const metadata: Metadata = {
  title: 'Sign in',
  description:
    'Sign in to glassbottles to throw today’s anonymous message in a bottle and check what washed ashore for you.',
  alternates: { canonical: '/sign-in' },
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}
