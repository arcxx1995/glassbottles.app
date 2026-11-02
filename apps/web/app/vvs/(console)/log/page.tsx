'use client'

import { useEffect, useState } from 'react'
import { CARD, PersonLink, caseId, errorText, rpc, when } from '../shared'

interface Row {
  id: number
  admin_id: string
  action: string
  subject_id: string | null
  created_at: string
  detail: { note?: string; why?: string; days?: number; kind?: string; reason?: string }
}

// Everything every admin has done. The database refuses edits and deletions.
export default function LogPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void rpc<Row[]>('admin_log').then(setRows).catch((e) => setError(errorText(e)))
  }, [])
  return (
    <>
      <h1 className="font-display text-2xl">Log</h1>
      {error && <p role="alert" className="font-ui text-xs text-coral">{error}</p>}
      {rows === null && !error && <p className="font-ui text-sm text-sand/45">Loading…</p>}
      {rows?.length === 0 && <p className="font-ui text-sm text-sand/45">Nothing yet.</p>}
      {rows && rows.length > 0 && (
        <div className={`${CARD} flex flex-col gap-2`}>
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-white/5 pt-2 first:border-0 first:pt-0">
              <span className="font-ui text-[11px] text-sand/40">{when(r.created_at)}</span>
              <span className="font-ui text-xs text-sand">{r.action.replace(/_/g, ' ')}</span>
              {r.subject_id && <PersonLink id={r.subject_id} />}
              <span className="font-mono text-[11px] text-sand/40">by {caseId(r.admin_id)}</span>
              {(r.detail?.note || r.detail?.why) && <span className="w-full font-ui text-xs text-sand/60">{r.detail.note ?? r.detail.why}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
