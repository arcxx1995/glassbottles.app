import type { Metadata } from 'next'

// page.tsx is a client component, so route metadata lives here.
export const metadata: Metadata = {
  title: 'Create an account',
  description:
    'Join glassbottles free. Throw one anonymous message in a bottle into the sea each day and see what a stranger sends back.',
  alternates: { canonical: '/sign-up' },
}

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children
}
