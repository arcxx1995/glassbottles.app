import { redirect } from 'next/navigation'

// Inbox is now the Shelf — bottles that found you live there.
export default function InboxPage() {
  redirect('/shelf')
}
