'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface QueueItem {
  id: string
  kind: 'bottle' | 'post' | 'comment' | 'scrap' | 'profile' | 'community' | 'user'
  source: 'screen' | 'report' | 'suspension'
  reason: string | null
  reports: number
  created_at: string
  text: string | null
  state: string | null
}

type Action = 'remove' | 'restore' | 'suspend' | 'dismiss'

const BTN = 'px-3 py-1.5 rounded-xl font-ui text-xs font-medium transition-colors disabled:opacity-40'

// Supabase-direct (admin_queue / admin_moderate RPCs). Loads once and after
// each action — no polling; the alert email says when to come back.
export default function ModerationQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('admin_queue')
    if (error) setError(error.message)
    else setItems(data as QueueItem[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(id: string, action: Action) {
    setBusy(id)
    setError(null)
    const { data, error } = await createClient().rpc('admin_moderate', { p_item: id, p_action: action })
    if (error) setError(error.message)
    else if (data === 'rewrite_exists') setError('The sender already threw a rewrite that day; this bottle stays ashore.')
    await load()
    setBusy(null)
  }

  return (
    <main className="relative z-10 min-h-screen px-4 py-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-3xl text-sand">Moderation</h1>
          <button type="button" onClick={() => void load()} className={`${BTN} text-sand/50 hover:text-sand/80`}>
            Refresh
          </button>
        </div>
        <p className="font-ui text-xs text-sand/45">
          Content only — authors are never shown. &ldquo;Suspend&rdquo; removes the content and suspends whoever wrote it.
        </p>
        {error && (
          <p className="font-ui text-xs text-coral" role="alert">
            {error}
          </p>
        )}
        {items === null && !error && <p className="font-ui text-sm text-sand/45">Loading…</p>}
        {items?.length === 0 && <p className="font-ui text-sm text-sand/45">Queue is empty.</p>}
        {items?.map((it) => (
          <article key={it.id} className="rounded-card border border-border-subtle bg-ocean-mid p-5 shadow-card">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-sand/40">
              {it.kind} · {it.source}
              {it.reason ? ` · ${it.reason}` : ''}
              {it.reports > 0 ? ` · ${it.reports} report${it.reports === 1 ? '' : 's'}` : ''}
              {` · ${it.state ?? 'gone'} · ${new Date(it.created_at).toLocaleString()}`}
            </p>
            <p className="mb-4 whitespace-pre-line font-display text-base leading-relaxed text-sand">
              {it.text ?? <span className="text-sand/40">(deleted)</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {it.kind !== 'user' && (
                <button type="button" disabled={busy === it.id} onClick={() => act(it.id, 'remove')}
                  className={`${BTN} bg-coral/15 text-coral hover:bg-coral/25`}>
                  Remove
                </button>
              )}
              <button type="button" disabled={busy === it.id} onClick={() => act(it.id, 'restore')}
                className={`${BTN} bg-seafoam/15 text-seafoam hover:bg-seafoam/25`}>
                {it.kind === 'user' ? 'Lift suspension' : 'Restore'}
              </button>
              {it.kind !== 'user' && (
                <button type="button" disabled={busy === it.id} onClick={() => act(it.id, 'suspend')}
                  className={`${BTN} bg-coral/15 text-coral hover:bg-coral/25`}>
                  Remove + suspend author
                </button>
              )}
              <button type="button" disabled={busy === it.id} onClick={() => act(it.id, 'dismiss')}
                className={`${BTN} text-sand/50 hover:text-sand/80`}>
                {it.kind === 'user' ? 'Keep suspended' : 'Dismiss'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
