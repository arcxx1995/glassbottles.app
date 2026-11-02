import type { ReportReason } from '@/types'

// The last two go to the top of the admin's queue, and email them within minutes.
export const REPORT_REASONS: [ReportReason, string][] = [
  ['sexual', 'Sexual'],
  ['harassment', 'Abusive'],
  ['spam', 'Spam'],
  ['contact', 'Contact info'],
  ['minor', 'Involves a minor'],
  ['danger', 'Someone may be in danger'],
  ['other', 'Other'],
]
