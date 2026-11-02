'use client'

import { useState } from 'react'
import { BTN, CARD, FIELD, PersonLink, Pill, errorText, rpc, statusTone } from '../shared'
import { cn } from '@/lib/utils'

// Find someone by their id, or an exact email (logged). And add an admin.
export default function PeoplePage() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<{ id: string; status: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [added, setAdded] = useState<string | null>(null)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      setRows(await rpc('admin_search', { p_query: q }))
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function addAdmin(e: React.FormEvent) {
    e.preventDefault()
    setAdded(null)
    try {
      const ok = await rpc<boolean>('admin_add_admin', { p_email: email })
      setAdded(ok ? 'Added. They have the same powers as you.' : 'No account has that email.')
    } catch (err) {
      setAdded(errorText(err))
    }
  }

  return (
    <>
      <h1 className="font-display text-2xl">People</h1>
      <form onSubmit={search} className={cn(CARD, 'flex flex-col gap-2')}>
        <label htmlFor="vvs-search" className="font-ui text-xs text-sand/60">
          Case ID (at least 6 characters), or an exact email. Searching by email is logged.
        </label>
        <div className="flex gap-2">
          <input id="vvs-search" value={q} onChange={(e) => setQ(e.target.value)} className={FIELD} />
          <button type="submit" className={cn(BTN, 'bg-white/10 text-sand')}>
            Search
          </button>
        </div>
        {error && <p role="alert" className="font-ui text-xs text-coral">{error}</p>}
        {rows?.length === 0 && <p className="font-ui text-sm text-sand/45">Nobody found.</p>}
        {rows?.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <PersonLink id={r.id} />
            {r.status !== 'active' && <Pill tone={statusTone(r.status)}>{r.status}</Pill>}
          </div>
        ))}
      </form>
      <form onSubmit={addAdmin} className={cn(CARD, 'flex flex-col gap-2')}>
        <label htmlFor="vvs-admin" className="font-ui text-xs text-sand/60">
          Add an admin by their account email
        </label>
        <div className="flex gap-2">
          <input id="vvs-admin" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
          <button type="submit" disabled={!email.trim()} className={cn(BTN, 'bg-white/10 text-sand')}>
            Add
          </button>
        </div>
        {added && <p role="status" className="font-ui text-xs text-sand/70">{added}</p>}
      </form>
    </>
  )
}
