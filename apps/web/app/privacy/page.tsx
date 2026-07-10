import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { LegalH2 } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How glassbottles collects, uses, and protects your information when you send anonymous messages in a bottle.',
  alternates: { canonical: '/privacy' },
}

const CONTACT = 'hello@glassbottles.app'

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="11 July 2026">
      <p>
        glassbottles (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;the service&rdquo;) is an
        anonymous message-in-a-bottle app. We keep the amount of personal data we collect to
        the minimum needed to run the service, and we never sell it. This policy explains what
        we collect, why, and the choices you have.
      </p>

      <LegalH2>Information we collect</LegalH2>
      <p>
        <strong className="text-sand/85">Account information.</strong> When you create an
        account we store your email address and an encrypted password, or — if you sign in with
        Google — the basic profile information Google shares (email and account identifier).
        Authentication is handled by Supabase on our behalf.
      </p>
      <p>
        <strong className="text-sand/85">Message content.</strong> The messages you write are
        stored so they can be delivered to another user. Messages are exchanged anonymously: the
        person who receives your bottle does not see your identity, and you do not see theirs.
      </p>
      <p>
        <strong className="text-sand/85">Preferences and technical data.</strong> We store a
        small amount of data needed to make the app work correctly, such as your time zone (to
        deliver your daily bottle at the right moment) and, if you enable them, push-notification
        subscription details.
      </p>
      <p>
        <strong className="text-sand/85">Usage analytics.</strong> We use privacy-friendly
        analytics (Vercel Analytics and Speed Insights) to understand aggregate traffic and
        performance. These do not use cookies to track you across other sites.
      </p>

      <LegalH2>How we use your information</LegalH2>
      <p>
        We use your information to operate the service: to authenticate you, deliver and receive
        bottles, send notifications you have opted into, prevent abuse, and keep the app fast and
        reliable. We do not use your messages to build advertising profiles.
      </p>

      <LegalH2>Anonymity between users</LegalH2>
      <p>
        The service is designed so that senders and recipients cannot identify one another
        through the app. Your email address and account details are never shown to other users.
        Please remember that anything you choose to write inside a message could reveal who you
        are — avoid sharing personal contact details you don&rsquo;t want a stranger to have.
      </p>

      <LegalH2>Sharing and disclosure</LegalH2>
      <p>
        We do not sell your personal data. We share it only with the infrastructure providers
        that run the service on our behalf — such as Supabase (database and authentication) and
        Vercel (hosting and analytics) — and only to the extent needed to operate glassbottles.
        We may disclose information if required by law or to protect the safety and rights of our
        users.
      </p>

      <LegalH2>Data retention</LegalH2>
      <p>
        We keep your account information for as long as your account is active. You can delete
        your account at any time, after which we remove your personal data, except where we are
        required to retain limited records to comply with legal obligations or prevent abuse.
      </p>

      <LegalH2>Your rights</LegalH2>
      <p>
        Depending on where you live, you may have the right to access, correct, export, or delete
        your personal data. To make a request, contact us at{' '}
        <a href={`mailto:${CONTACT}`} className="text-seafoam hover:underline">
          {CONTACT}
        </a>
        .
      </p>

      <LegalH2>Children</LegalH2>
      <p>
        glassbottles is not intended for anyone under 13 (or the minimum age required in your
        country). We do not knowingly collect data from children.
      </p>

      <LegalH2>Changes to this policy</LegalH2>
      <p>
        We may update this policy from time to time. When we do, we will revise the &ldquo;last
        updated&rdquo; date above. Significant changes will be communicated within the app.
      </p>

      <LegalH2>Contact</LegalH2>
      <p>
        Questions about privacy? Email us at{' '}
        <a href={`mailto:${CONTACT}`} className="text-seafoam hover:underline">
          {CONTACT}
        </a>
        . See also our{' '}
        <Link href="/terms" className="text-seafoam hover:underline">
          Terms &amp; Conditions
        </Link>
        .
      </p>
    </LegalPage>
  )
}
