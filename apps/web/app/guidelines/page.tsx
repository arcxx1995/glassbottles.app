import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { LegalH2 } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Community Guidelines',
  description:
    'What you can and can’t send on glassbottles, how every message is screened before delivery, and how reports and enforcement work.',
  alternates: { canonical: '/guidelines' },
}

const CONTACT = 'hello@glassbottles.app'

const list = 'flex flex-col gap-1.5 pl-5 list-disc marker:text-seafoam/60'

export default function GuidelinesPage() {
  return (
    <LegalPage title="Community Guidelines" lastUpdated="24 October 2026">
      <p>
        glassbottles is a quiet place for adults to write one honest note a day to a stranger.
        Heavy feelings, grief, anger at life and dark humour are welcome here. Using the sea to
        hurt, proposition or reach someone is not.
      </p>

      <LegalH2>Who can use glassbottles</LegalH2>
      <p>
        You must be 18 or older. Everyone confirms this before they can send or receive a bottle.
        Accounts we believe belong to a minor are removed.
      </p>

      <LegalH2>Never allowed</LegalH2>
      <ul className={list}>
        <li>
          <strong className="text-sand/85">Sexual content of any kind:</strong> explicit or
          suggestive messages, sexual propositions, sexual roleplay, or asking for intimate images.
        </li>
        <li>
          <strong className="text-sand/85">Anything that sexualises minors.</strong> Zero
          tolerance: the account is suspended immediately and we report it to the relevant
          authorities (such as NCMEC).
        </li>
        <li>
          <strong className="text-sand/85">Harassment and hate:</strong> insults, threats,
          bullying, slurs, dehumanising a person or group, or telling anyone to hurt or kill
          themselves.
        </li>
        <li>
          <strong className="text-sand/85">Contact details and meet-ups:</strong> phone numbers,
          emails, social handles, links, or ways to talk off the app. Bottles stay anonymous both
          ways.
        </li>
        <li>
          <strong className="text-sand/85">Spam and scams:</strong> ads, promotion, chain messages,
          phishing.
        </li>
        <li>
          <strong className="text-sand/85">Illegal content</strong> or encouraging dangerous or
          illegal acts.
        </li>
      </ul>

      <LegalH2>How every bottle is checked</LegalH2>
      <p>Nothing you write reaches another person until it has passed these checks:</p>
      <ul className={list}>
        <li>
          <strong className="text-sand/85">At send:</strong> a filter rejects clearly prohibited
          words and phrases before the message is accepted.
        </li>
        <li>
          <strong className="text-sand/85">Before delivery:</strong> an automated classifier reads
          the text (never your name or email) and holds anything that breaks these rules. A bottle
          is not delivered until it has a verdict &mdash; if the check can&rsquo;t run, the bottle
          waits rather than going out unchecked.
        </li>
        <li>
          <strong className="text-sand/85">Human review:</strong> anything the classifier is unsure
          about, and everything that&rsquo;s reported, goes to a moderator. Moderators see the
          message, not who wrote it.
        </li>
      </ul>
      <p>
        Text is the only thing you can send: there are no photos, videos or links in bottles, each
        message is capped at 1,000 characters, and you can send one bottle a day.
      </p>
      <p>
        If a message reads like the writer may be in danger, it is still delivered and the writer
        is shown where to find help.
      </p>

      <LegalH2>Reporting</LegalH2>
      <p>
        Every bottle you receive has a report flag. Reporting removes it from your inbox at once
        and sends it to a moderator, who can remove it and act on the sender&rsquo;s account. The
        sender is never told who reported them.
      </p>

      <LegalH2>Enforcement</LegalH2>
      <ul className={list}>
        <li>A held bottle isn&rsquo;t delivered; you can rewrite it once the same day.</li>
        <li>
          Three violations within 30 days &mdash; held sexual or abusive messages, or reports
          against you &mdash; suspend your account automatically, pending review.
        </li>
        <li>Any content sexualising a minor suspends the account immediately.</li>
        <li>
          A suspended account can&rsquo;t send anything, and its bottles still drifting are pulled
          from the sea.
        </li>
      </ul>
      <p>
        Think we got it wrong? Email{' '}
        <a href={`mailto:${CONTACT}`} className="text-seafoam hover:underline">
          {CONTACT}
        </a>{' '}
        from your account&rsquo;s address and a person will look again.
      </p>

      <p>
        These guidelines are part of our{' '}
        <Link href="/terms" className="text-seafoam hover:underline">
          Terms &amp; Conditions
        </Link>
        . See also our{' '}
        <Link href="/privacy" className="text-seafoam hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </LegalPage>
  )
}
