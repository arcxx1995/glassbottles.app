import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { LegalH2 } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'The terms and conditions for using glassbottles, the anonymous message-in-a-bottle app.',
  alternates: { canonical: '/terms' },
}

const CONTACT = 'hello@glassbottles.app'

export default function TermsPage() {
  return (
    <LegalPage title="Terms &amp; Conditions" lastUpdated="24 October 2026">
      <p>
        Welcome to glassbottles. By creating an account or using the service you agree to these
        Terms &amp; Conditions. If you do not agree, please do not use the service.
      </p>

      <LegalH2>The service</LegalH2>
      <p>
        glassbottles lets you write one anonymous message a day, &ldquo;throw&rdquo; it into a
        shared digital sea, and receive a stranger&rsquo;s message in return. Messages are
        exchanged anonymously. The service is provided free of charge, and features may change
        over time.
      </p>

      <LegalH2>Eligibility</LegalH2>
      <p>
        glassbottles is for adults only. You must be at least 18 years old to create an account or
        use the service, and you confirm this when you sign up. We remove accounts we believe
        belong to anyone under 18.
      </p>

      <LegalH2>Your account</LegalH2>
      <p>
        You are responsible for keeping your login credentials secure and for all activity under
        your account. Provide accurate information when signing up, and let us know if you believe
        your account has been compromised.
      </p>

      <LegalH2>Acceptable use</LegalH2>
      <p>You agree not to use glassbottles to write, send, or solicit any message that:</p>
      <ul className="flex flex-col gap-1.5 pl-5 list-disc marker:text-seafoam/60">
        <li>harasses, threatens, bullies, or targets another person, or urges anyone to self-harm;</li>
        <li>is hateful, discriminatory, or incites violence;</li>
        <li>
          is sexual in any way &mdash; explicit or suggestive content, sexual propositions, or
          requests for intimate images;
        </li>
        <li>sexualises or endangers minors in any way (we report this to the authorities);</li>
        <li>is spam, a scam, or an attempt to advertise or phish;</li>
        <li>shares another person&rsquo;s private information without consent;</li>
        <li>is illegal, or promotes illegal or dangerous activity.</li>
      </ul>
      <p>
        You also agree not to attempt to de-anonymise other users, disrupt or overload the
        service, or access it through automated means without our permission.
      </p>

      <LegalH2>Content and moderation</LegalH2>
      <p>
        You retain ownership of the messages you write, but you grant us the limited right to
        store, screen and deliver them as part of running the service. Every message is checked
        before anyone else can see it: a filter blocks clearly prohibited words when you press
        send, and an automated classifier reviews the text before it is delivered. Nothing is
        delivered until that check has passed. Content the classifier is unsure about, and content
        other users report, goes to a human moderator.
      </p>
      <p>
        We may withhold or remove content and suspend or terminate accounts that violate these
        terms. Accounts are suspended automatically after repeated violations, and immediately for
        any content that sexualises minors. The full rules and how enforcement works are in our{' '}
        <Link href="/guidelines" className="text-seafoam hover:underline">
          Community Guidelines
        </Link>
        , which form part of these terms.
      </p>

      <LegalH2>Anonymity &amp; safety</LegalH2>
      <p>
        Messages are delivered anonymously. Never rely on the service to keep information private
        that you type into a message — do not share personal contact details, financial
        information, or anything you would not want an anonymous stranger to read. If you receive
        a message that violates these terms, please report it so we can act.
      </p>

      <LegalH2>Termination</LegalH2>
      <p>
        You may stop using glassbottles and delete your account at any time. We may suspend or
        terminate your access if you breach these terms or use the service in a way that harms
        other users or the service itself.
      </p>

      <LegalH2>Disclaimer &amp; limitation of liability</LegalH2>
      <p>
        glassbottles is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
        warranties of any kind. We do not guarantee that the service will be uninterrupted,
        error-free, or that any particular message will be delivered. To the fullest extent
        permitted by law, we are not liable for any indirect, incidental, or consequential
        damages arising from your use of the service, including any content you receive from
        other users.
      </p>

      <LegalH2>Changes to these terms</LegalH2>
      <p>
        We may update these terms from time to time. When we do, we will revise the &ldquo;last
        updated&rdquo; date above. Continuing to use the service after changes take effect means
        you accept the updated terms.
      </p>

      <LegalH2>Contact</LegalH2>
      <p>
        Questions about these terms? Email us at{' '}
        <a href={`mailto:${CONTACT}`} className="text-seafoam hover:underline">
          {CONTACT}
        </a>
        . See also our{' '}
        <Link href="/privacy" className="text-seafoam hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </LegalPage>
  )
}
