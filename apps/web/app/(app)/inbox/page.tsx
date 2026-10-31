import { redirect } from 'next/navigation'

// The Inbox became the Shelf. Old links, emails and installed service workers
// still land here, so keep this and carry the query across.
export default function InboxPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const query = new URLSearchParams(
    Object.entries(searchParams).flatMap(([k, v]) => [v ?? ''].flat().map((x) => [k, x])),
  ).toString()
  redirect(query ? `/shelf?${query}` : '/shelf')
}
