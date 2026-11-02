'use client'

import { useCallback, useEffect, useState } from 'react'
import ConfirmButton from '@/components/ui/ConfirmButton'
import { cn } from '@/lib/utils'
import { BTN, CARD, FIELD, KIND, Pill, REASON, caseId, cancelBilling, errorText, rpc, statusTone, when } from '../../shared'

interface Person {
  id: string
  status: string
  suspended_until: string | null
  suspension_reason: string | null
  joined: string
  last_active: string | null
  age_confirmed: boolean
  is_admin: boolean
  membership: { plan: string; status: string; access_until: string; live: boolean } | null
  counts: { bottles: number; notes: number; comments: number; blocks_made: number; blocked_by: number }
  as_reporter: { filed: number; upheld: number; dismissed: number }
  flags: { id: string; note: string; at: string }[]
  reports: { id: string; kind: string; reason: string; status: string; outcome: string | null; evidence: string | null; at: string }[]
  ai_holds: { kind: string; reason: string | null; text: string; at: string }[]
  log: { action: string; detail: Record<string, unknown>; at: string }[]
}

// A person: their standing and history, under a case ID. Their email takes a
// logged Reveal. Their words appear only if reported or held by the AI.
export default function PersonPage({ params }: { params: { id: string } }) {
  const [p, setP] = useState<Person | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [flag, setFlag] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [removeAll, setRemoveAll] = useState(false)

  const load = useCallback(async () => {
    try {
      setP(await rpc<Person>('admin_person', { p_subject: params.id }))
    } catch (e) {
      setError(errorText(e))
    }
  }, [params.id])
  useEffect(() => void load(), [load])

  async function act(run: () => Promise<string>) {
    setError(null)
    setNotice(null)
    try {
      setNotice(await run())
      setNote('')
      setMessage('')
      setRemoveAll(false)
      setFlag('')
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const person = (outcome: string, days: number | null) =>
    rpc('admin_act_on_person', {
      p_subject: params.id,
      p_outcome: outcome,
      p_days: days,
      p_note: note.trim() || null,
      p_message: message.trim() || null,
      p_remove_all: removeAll,
    })

  if (!p) return error ? <p role="alert" className="font-ui text-sm text-coral">{error}</p> : <p className="font-ui text-sm text-sand/45">Loading…</p>

  const restricted = p.status !== 'active'
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-xl">{caseId(p.id)}</h1>
        <Pill tone={statusTone(p.status)}>{p.status}</Pill>
        {p.flags.length > 0 && <Pill tone="warn">Flagged</Pill>}
        {p.is_admin && <Pill>Admin</Pill>}
        {p.membership?.live && <Pill tone="good">Keeper: {p.membership.plan}</Pill>}
      </div>
      {notice && <p role="status" className="rounded-xl bg-seafoam/10 px-3 py-2 font-ui text-xs text-seafoam">{notice}</p>}
      {error && <p role="alert" className="font-ui text-xs text-coral">{error}</p>}

      <section className={cn(CARD, 'flex flex-col gap-1 font-ui text-sm text-sand/80')}>
        <p>Joined {when(p.joined)}. Last active {when(p.last_active) || 'never'}.</p>
        {p.suspended_until && <p>Suspended until {when(p.suspended_until)}.</p>}
        {p.suspension_reason && <p>Why: {p.suspension_reason}.</p>}
        <p>Wrote {p.counts.bottles} bottles, {p.counts.notes} notes, {p.counts.comments} comments.</p>
        <p>Blocked {p.counts.blocks_made} people. Blocked by {p.counts.blocked_by}.</p>
        <p>
          As a reporter: filed {p.as_reporter.filed}, upheld {p.as_reporter.upheld}, dismissed {p.as_reporter.dismissed}.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {email ? (
            <span className="font-mono text-xs">{email}</span>
          ) : (
            <ConfirmButton
              confirmLabel="Reveal? This is logged."
              onConfirm={() => act(async () => {
                setEmail(await rpc<string | null>('admin_reveal_email', { p_subject: p.id }) ?? 'No email on this account')
                return 'Revealed, and logged.'
              })}
              className={cn(BTN, 'bg-white/10 text-sand')}
            >
              Reveal email
            </ConfirmButton>
          )}
        </div>
      </section>

      <section className={cn(CARD, 'flex flex-col gap-2')}>
        <h2 className="font-ui text-sm font-medium">Act</h2>
        {restricted ? (
          <>
            <textarea aria-label="Reason, for the log" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason, for the log (optional)" className={FIELD} />
            <div>
              <ConfirmButton
                confirmLabel="Lift it?"
                onConfirm={() => act(async () => {
                  await rpc('admin_lift', { p_subject: p.id, p_note: note.trim() || null })
                  return 'Lifted. They’ve been told.'
                })}
                className={cn(BTN, 'bg-seafoam/15 text-seafoam')}
              >
                Lift {p.status === 'banned' ? 'ban' : 'suspension'}
              </ConfirmButton>
            </div>
          </>
        ) : (
          <>
            <textarea aria-label="Reason, for the log" value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} placeholder="Reason, for the log (required)" className={FIELD} />
            <textarea aria-label="Added to what they’re told" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 500))} rows={2} placeholder="Added to the email and notice they get (optional)" className={FIELD} />
            <label className="flex items-center gap-2 font-ui text-xs text-sand/70">
              <input type="checkbox" checked={removeAll} onChange={(e) => setRemoveAll(e.target.checked)} />
              Remove everything from this person
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={!note.trim()} onClick={() => act(async () => { await person('warn', null); return 'Warned.' })} className={cn(BTN, 'bg-white/10 text-sand')}>
                Warn
              </button>
              <button type="button" disabled={!note.trim()} onClick={() => act(async () => { await person('suspend', 7); return 'Suspended for 7 days.' })} className={cn(BTN, 'bg-coral/15 text-coral')}>
                Suspend 7 days
              </button>
              <button type="button" disabled={!note.trim()} onClick={() => act(async () => { await person('suspend', 30); return 'Suspended for 30 days.' })} className={cn(BTN, 'bg-coral/15 text-coral')}>
                Suspend 30 days
              </button>
              <ConfirmButton
                confirmLabel="Ban them?"
                disabled={!note.trim()}
                onConfirm={() => act(async () => { await person('ban', null); return cancelBilling(p.id) })}
                className={cn(BTN, 'bg-coral/25 text-coral')}
              >
                Ban
              </ConfirmButton>
            </div>
          </>
        )}
      </section>

      <section className={cn(CARD, 'flex flex-col gap-2')}>
        <h2 className="font-ui text-sm font-medium">Flags</h2>
        {p.flags.map((f) => (
          <div key={f.id} className="flex items-start gap-2">
            <p className="flex-1 font-ui text-sm text-sand/80">{f.note} <span className="text-[11px] text-sand/40">{when(f.at)}</span></p>
            <button type="button" onClick={() => act(async () => { await rpc('admin_unflag', { p_flag: f.id }); return 'Flag cleared.' })} className={cn(BTN, 'text-sand/50')}>
              Clear
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input aria-label="New flag" value={flag} onChange={(e) => setFlag(e.target.value)} placeholder="Private note. They’re never told." className={FIELD} />
          <button type="button" disabled={!flag.trim()} onClick={() => act(async () => { await rpc('admin_flag', { p_subject: p.id, p_note: flag }); return 'Flagged.' })} className={cn(BTN, 'bg-white/10 text-sand')}>
            Flag
          </button>
        </div>
      </section>

      <History title="Reports about them" empty="None.">
        {p.reports.map((r) => (
          <div key={r.id} className="border-t border-white/5 pt-2 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill>{KIND[r.kind] ?? r.kind}</Pill>
              {r.kind !== 'block' && <Pill>{REASON[r.reason] ?? r.reason}</Pill>}
              <Pill tone={r.status === 'upheld' ? 'bad' : 'plain'}>{r.outcome ?? r.status}</Pill>
              <span className="ml-auto font-ui text-[11px] text-sand/40">{when(r.at)}</span>
            </div>
            {r.evidence && <p className="mt-1 whitespace-pre-line font-display text-sm">{r.evidence}</p>}
          </div>
        ))}
      </History>

      <History title="Held by the AI" empty="None.">
        {p.ai_holds.map((h, i) => (
          <div key={i} className="border-t border-white/5 pt-2 first:border-0 first:pt-0">
            <div className="flex items-center gap-1.5">
              <Pill>{KIND[h.kind] ?? h.kind}</Pill>
              <Pill>{REASON[h.reason ?? ''] ?? h.reason}</Pill>
              <span className="ml-auto font-ui text-[11px] text-sand/40">{when(h.at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-line font-display text-sm">{h.text}</p>
          </div>
        ))}
      </History>

      <History title="What admins have done" empty="Nothing yet.">
        {p.log.map((l, i) => (
          <p key={i} className="font-ui text-xs text-sand/70">
            <span className="text-sand/40">{when(l.at)}</span> {l.action.replace(/_/g, ' ')}
            {typeof l.detail?.note === 'string' && l.detail.note ? `: ${l.detail.note}` : ''}
          </p>
        ))}
      </History>
    </>
  )
}

function History({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className={cn(CARD, 'flex flex-col gap-2')}>
      <h2 className="font-ui text-sm font-medium">{title}</h2>
      {children.length === 0 ? <p className="font-ui text-xs text-sand/45">{empty}</p> : children}
    </section>
  )
}
