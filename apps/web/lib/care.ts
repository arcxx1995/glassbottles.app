// Crisis care (migration 043). The server's screen is the real judgment; this
// is only the instant first signal at throw time, so help shows up while the
// screen is still reading. It never blocks or changes the bottle.

const CRISIS =
  /\b(kill(ing)? myself|suicid(e|al)|end (it all|my life)|want(ed)? to die|don'?t want to (live|be here|exist)|self[- ]?harm|hurt(ing)? myself|cut(ting)? myself|no reason to live|better off (dead|without me))\b/i

export function looksLikeCrisis(text: string): boolean {
  return CRISIS.test(text)
}

export interface HelpLine {
  name: string
  detail: string
  href: string
}

const DIRECTORY: HelpLine = {
  name: 'Find a helpline',
  detail: 'Free, confidential lines in your country',
  href: 'https://findahelpline.com',
}

const US_CA = new Set([
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'America/Detroit', 'America/Boise',
  'America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg',
  'America/Halifax', 'America/St_Johns', 'America/Regina', 'Pacific/Honolulu',
])

/** A best guess from the profile timezone — never shown as a claim about
 *  where someone is; the worldwide directory is always offered too. */
export function helpLinesFor(timezone: string | null | undefined): HelpLine[] {
  const tz = timezone ?? ''
  let local: HelpLine | null = null
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') {
    local = { name: 'Tele-MANAS', detail: 'Call 14416, any time', href: 'tel:14416' }
  } else if (US_CA.has(tz) || tz.startsWith('America/Indiana/') || tz.startsWith('America/Kentucky/')) {
    local = { name: '988 Lifeline', detail: 'Call or text 988, any time', href: 'tel:988' }
  } else if (tz === 'Europe/London' || tz === 'Europe/Dublin') {
    local = { name: 'Samaritans', detail: 'Call 116 123, any time', href: 'tel:116123' }
  } else if (tz.startsWith('Australia/')) {
    local = { name: 'Lifeline', detail: 'Call 13 11 14, any time', href: 'tel:131114' }
  }
  return local ? [local, DIRECTORY] : [DIRECTORY]
}
