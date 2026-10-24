import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { LegalH2 } from '@/components/legal/LegalPage'
import { CookieSettingsButton } from '@/components/providers/ConsentAnalytics'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How glassbottles collects, uses, and protects your information when you send anonymous messages in a bottle.',
  alternates: { canonical: '/privacy' },
}

const CONTACT = 'hello@glassbottles.app'

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="24 October 2026">
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
        <strong className="text-sand/85">Usage analytics.</strong> We use Vercel Analytics and
        Speed Insights to understand aggregate traffic and performance. These do not use cookies
        to track you across other sites.
      </p>
      <p>
        We also use Google Analytics to learn how people find and use the site (for example,
        which pages are visited and from which country). Google Analytics sets cookies and
        collects your IP address, device and browser details, and pages viewed. It never sees
        your messages. You can opt out with the{' '}
        <a
          href="https://tools.google.com/dlpage/gaoptout"
          className="text-seafoam hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Analytics opt-out browser add-on
        </a>{' '}
        or by blocking cookies in your browser. It only loads after you accept it in the cookie
        banner; you can change your choice any time via <CookieSettingsButton />.
      </p>

      <LegalH2>How we use your information</LegalH2>
      <p>
        We use your information to operate the service: to authenticate you, deliver and receive
        bottles, send notifications you have opted into, prevent abuse, and keep the app fast and
        reliable. We do not use your messages to build advertising profiles.
      </p>
      <p>
        To keep the sea safe, the text of each message &mdash; never your name, email or account
        &mdash; is checked by an automated AI classifier before it is delivered, to catch sexual
        content, cruelty, contact details and spam, and to offer support if a message reads like
        you may be in danger. The check runs through OpenRouter, which we instruct to use only AI
        providers that neither store the text nor train on it; it is processed only to return that
        check. Messages that are held by the check or reported by another user may be read by a
        moderator, who sees the message but not who wrote it. We keep moderation records (the
        verdict, reports and any action taken) to enforce our rules and prevent abuse.
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
        Vercel (hosting and analytics), Google (analytics), OpenRouter (message safety checks) and
        Resend (email) — and only to the extent needed to operate glassbottles.
        We may disclose information if required by law or to protect the safety and rights of our
        users.
      </p>

      <LegalH2>Data retention</LegalH2>
      <p>
        We keep your account information for as long as your account is active. You can delete
        your account at any time, after which we remove your personal data, your inbox, and any
        bottles still drifting. Bottles you sent that were already delivered stay in the
        recipient&rsquo;s inbox, unlinked from you &mdash; we keep no record of who wrote them. We may
        retain limited records where required to comply with legal obligations or prevent abuse.
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
        glassbottles is for adults aged 18 and over. We do not knowingly collect data from anyone
        under 18, and we delete accounts we learn belong to a minor.
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
