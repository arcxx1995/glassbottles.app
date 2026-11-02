'use client'

import { useCallback, useEffect, useState } from 'react'
import ConfirmButton from '@/components/ui/ConfirmButton'
import { cn } from '@/lib/utils'
import { BTN, CARD, FIELD, KIND, PersonLink, Pill, REASON, cancelBilling, errorText, rpc, statusTone, when } from './shared'

interface Report {
  id: string
  kind: string
  reason: string
  urgent: boolean
  status: string
  outcome: string | null
  evidence: string | null
  auto_applied: boolean
  created_at: string
  decided_at: string | null
  decision_note: string | null
  subject_id: string | null
  reporter_id: string | null
  subject_status: string | null
  subject_flagged: boolean
  reports_on_item: number
}

const OUTCOME: Record<string, string> = {
  dismiss: 'Dismissed',
  remove: 'Removed',
  warn: 'Removed + warned',
  suspend: 'Removed + suspended',
  ban: 'Removed + banned',
  block_kept: 'Block kept',
  block_removed: 'Block removed',
  block_undone: 'Undone by the person',
}

// Reports & blocks: every case a user raised. Urgent first. Loads on open and
// after each decision, with no polling.
export default function ReportsPage() {
  const [open, setOpen] = useState(true)
  const [items, setItems] = useState<Report[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await rpc<Report[]>('admin_reports', { p_open: open }))
    } catch (e) {
      setError(errorText(e))
    }
  }, [open])

  useEffect(() => {
    setItems(null)
    void load()
  }, [load])

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Reports &amp; blocks</h1>
        <div className="flex gap-1" role="group" aria-label="Which cases">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={open === v}
              onClick={() => setOpen(v)}
              className={cn(BTN, open === v ? 'bg-white/10 text-sand' : 'text-sand/50')}
            >
              {v ? 'Open' : 'Decided'}
            </button>
          ))}
        </div>
      </div>
      {done && (
        <p role="status" className="rounded-xl bg-seafoam/10 px-3 py-2 font-ui text-xs text-seafoam">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="font-ui text-xs text-coral">
          {error}
        </p>
      )}
      {items === null && !error && <p className="font-ui text-sm text-sand/45">Loading…</p>}
      {items?.length === 0 && <p className="font-ui text-sm text-sand/45">{open ? 'Nothing waiting.' : 'Nothing decided yet.'}</p>}
      {items?.map((r) => (
        <article key={r.id} className={cn(CARD, r.urgent && r.status === 'open' && 'border-coral/50')}>
          <div className="flex flex-wrap items-center gap-1.5">
            {r.urgent && r.status === 'open' && <Pill tone="bad">Urgent</Pill>}
            <Pill>{KIND[r.kind] ?? r.kind}</Pill>
            {r.kind !== 'block' && r.kind !== 'strikes' && <Pill tone={r.urgent ? 'bad' : 'plain'}>{REASON[r.reason] ?? r.reason}</Pill>}
            {r.auto_applied && <Pill tone="warn">Live site: strike already applied</Pill>}
            {r.subject_flagged && <Pill tone="warn">Flagged</Pill>}
            {r.subject_status && r.subject_status !== 'active' && <Pill tone={statusTone(r.subject_status)}>{r.subject_status}</Pill>}
            {r.reports_on_item > 1 && <Pill>{r.reports_on_item} reports on this</Pill>}
            {r.outcome && <Pill tone="good">{OUTCOME[r.outcome] ?? r.outcome}</Pill>}
            <span className="ml-auto font-ui text-[11px] text-sand/40">{when(r.created_at)}</span>
          </div>

          {r.evidence && <p className="mt-3 whitespace-pre-line font-display text-base leading-relaxed">{r.evidence}</p>}
          {r.kind === 'strikes' && <p className="mt-3 font-ui text-sm text-sand/75">This person reached 3 strikes in 30 days. Nothing happens to them unless you decide.</p>}
          {r.kind === 'block' && <p className="mt-3 font-ui text-sm text-sand/75">Already in effect. Keep it, or remove it. The person who blocked isn&rsquo;t told.</p>}

          <div className="mt-3 flex flex-wrap gap-3">
            <PersonLink id={r.subject_id} role={r.kind === 'block' ? 'blocked:' : 'about:'} />
            {r.reporter_id && <PersonLink id={r.reporter_id} role={r.kind === 'block' ? 'by:' : 'reported by:'} />}
          </div>
          {r.decision_note && <p className="mt-2 font-ui text-xs text-sand/55">Reason: {r.decision_note}</p>}

          {r.status === 'open' &&
            (r.kind === 'block' ? (
              <BlockReview report={r} onDone={(m) => { setDone(m); void load() }} />
            ) : (
              <Decision report={r} onDone={(m) => { setDone(m); void load() }} />
            ))}
        </article>
      ))}
    </>
  )
}

function BlockReview({ report, onDone }: { report: Report; onDone: (m: string) => void }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function act(fn: string, msg: string) {
    try {
      await rpc(fn, { p_report: report.id, p_note: note || null })
      onDone(msg)
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-white/5 pt-3">
      <input aria-label="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" className={FIELD} />
      <div className="flex gap-2">
        <button type="button" onClick={() => act('admin_uphold_block', 'Block kept.')} className={cn(BTN, 'bg-seafoam/15 text-seafoam')}>
          Keep block
        </button>
        <ConfirmButton confirmLabel="Remove it?" onConfirm={() => act('admin_remove_block', 'Block removed.')} className={cn(BTN, 'bg-white/10 text-sand')}>
          Remove block
        </ConfirmButton>
      </div>
      {error && <p role="alert" className="font-ui text-xs text-coral">{error}</p>}
    </div>
  )
}

function Decision({ report, onDone }: { report: Report; onDone: (m: string) => void }) {
  const noContent = report.kind === 'strikes'
  const CHOICES: { key: string; outcome: string; days?: number; label: string }[] = [
    { key: 'dismiss', outcome: 'dismiss', label: 'Dismiss' },
    ...(noContent ? [] : [{ key: 'remove', outcome: 'remove', label: 'Remove' }]),
    { key: 'warn', outcome: 'warn', label: noContent ? 'Warn' : 'Remove + warn' },
    { key: 'suspend7', outcome: 'suspend', days: 7, label: noContent ? 'Suspend 7 days' : 'Remove + suspend 7 days' },
    { key: 'suspend30', outcome: 'suspend', days: 30, label: noContent ? 'Suspend 30 days' : 'Remove + suspend 30 days' },
    { key: 'ban', outcome: 'ban', label: noContent ? 'Ban' : 'Remove + ban' },
  ]
  const [pick, setPick] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [removeAll, setRemoveAll] = useState(false)
  const [flag, setFlag] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choice = CHOICES.find((c) => c.key === pick)
  const tellsThem = choice && ['warn', 'suspend', 'ban'].includes(choice.outcome)
  const canRemoveAll = choice && choice.outcome !== 'dismiss'
  const ready = !!choice && (choice.outcome === 'dismiss' || note.trim().length > 0) && !busy

  async function apply() {
    if (!choice) return
    setBusy(true)
    setError(null)
    try {
      const res = await rpc<{ status: string; subject_id?: string }>('admin_decide_report', {
        p_id: report.id,
        p_outcome: choice.outcome,
        p_days: choice.days ?? null,
        p_note: note.trim() || null,
        p_message: tellsThem ? message.trim() || null : null,
        p_remove_all: !!canRemoveAll && removeAll,
        p_flag_note: flag.trim() || null,
      })
      if (res.status === 'already_decided') onDone('Someone already decided that one.')
      else if (choice.outcome === 'ban' && res.subject_id) onDone(await cancelBilling(res.subject_id))
      else onDone(`Done: ${choice.label}.`)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  const applyClass = cn(BTN, choice?.outcome === 'dismiss' ? 'bg-white/10 text-sand' : 'bg-coral/20 text-coral')
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-white/5 pt-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Outcome">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={pick === c.key}
            onClick={() => setPick(c.key)}
            className={cn(BTN, pick === c.key ? 'bg-sand text-ocean-deep' : 'bg-white/5 text-sand/75')}
          >
            {c.label}
          </button>
        ))}
      </div>
      {choice && (
        <>
          <textarea
            aria-label="Reason, for the log"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            rows={2}
            placeholder={choice.outcome === 'dismiss' ? 'Reason, for the log (optional)' : 'Reason, for the log (required)'}
            className={FIELD}
          />
          {tellsThem && (
            <textarea
              aria-label="Added to what they’re told"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="Added to the email and notice they get (optional)"
              className={FIELD}
            />
          )}
          {canRemoveAll && (
            <label className="flex items-center gap-2 font-ui text-xs text-sand/70">
              <input type="checkbox" checked={removeAll} onChange={(e) => setRemoveAll(e.target.checked)} />
              Remove everything from this person
            </label>
          )}
          <input aria-label="Flag this person (optional)" value={flag} onChange={(e) => setFlag(e.target.value)} placeholder="Flag this person: private note (optional)" className={FIELD} />
          <div>
            {choice.outcome === 'ban' ? (
              <ConfirmButton confirmLabel="Ban them?" disabled={!ready} onConfirm={apply} className={applyClass}>
                Apply: {choice.label}
              </ConfirmButton>
            ) : (
              <button type="button" disabled={!ready} onClick={apply} className={applyClass}>
                Apply: {choice.label}
              </button>
            )}
          </div>
        </>
      )}
      {error && <p role="alert" className="font-ui text-xs text-coral">{error}</p>}
    </div>
  )
}
