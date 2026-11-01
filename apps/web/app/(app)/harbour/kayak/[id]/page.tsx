'use client'

import { useEffect, useState } from 'react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'motion/react'
import { Check, ChevronLeft, Flag, Minus, Plus, X } from 'lucide-react'
import CheckedText, { useLiveCheck } from '@/components/harbour/CheckedText'
import GemArt from '@/components/harbour/GemArt'
import HarbourWater from '@/components/harbour/HarbourWater'
import KayakArt from '@/components/harbour/KayakArt'
import ConfirmButton from '@/components/ui/ConfirmButton'
import Sheet from '@/components/ui/Sheet'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { gemName } from '@/lib/gems/engine'
import { MAX_GEMS, NOTE_MAX, kayakStatus, lightAt, type KayakDetail, type Light } from '@/lib/harbour'
import {
  COLORS,
  DECK_ITEMS,
  DECK_SLOTS,
  DEFAULT_LOOK,
  PADDLE_STYLES,
  PATTERNS,
  VESSELS,
  type DeckItem,
  type DeckSlot,
  type KayakLook,
} from '@/lib/kayakLook'
import { cn } from '@/lib/utils'
import {
  useDeleteKayakMutation,
  useEditNoteMutation,
  useGetHarbourQuery,
  useGetKayakQuery,
  useLaunchKayakMutation,
  useLoadGemsMutation,
  useRecallKayakMutation,
  useReportCommentMutation,
  useSaveKayakLookMutation,
  useUnloadGemMutation,
} from '@/store/api/bottleApi'
import type { ReportReason } from '@/types'

// One of your Kayaks (063). At the mast: dress it, fill it with gems, write its
// note and launch. At sea: where it is, the note, calling it home. Its log stays.
// /harbour/kayak/new is the same page before the Kayak exists.

const words = (s: string) => s.replace(/_/g, ' ')
const VESSEL_NAME: Record<string, string> = { sit_on_top: 'Sit-on-top' }
const nameOf = (s: string) => VESSEL_NAME[s] ?? words(s).replace(/^./, (c) => c.toUpperCase())

const ERRORS: Record<string, string> = {
  content_not_allowed: 'That note isn’t allowed here.',
  keeper_only: 'Kayaks are for Keepers. Renew to keep building and launching.',
  kayak_limit: 'You can have up to 3 Kayaks.',
  at_sea: 'This Kayak is at sea. It can change once it’s home.',
  not_at_sea: 'This Kayak isn’t at sea any more.',
  not_enough_gems: 'You don’t have that many gems left this month.',
  bad_count: 'A Kayak carries up to 30 gems.',
  no_gems: 'Fill your Kayak with at least one gem first.',
  too_many_notes: 'That’s a lot of notes for one day. Try again tomorrow.',
  edit_limit: 'You’ve used all 3 note changes for this voyage.',
  edit_pending: 'Your last change is still being checked.',
  account_suspended: 'Your account is suspended.',
  age_unconfirmed: 'Please confirm you’re 18 or older first.',
}
const errorText = (err: unknown) => ERRORS[(err as { error?: string })?.error ?? ''] ?? 'Something went wrong. Try again.'

const END_REASON: Record<string, string> = {
  empty: 'Every gem found a keeper',
  recalled: 'You called it home',
  lapsed: 'Came home when your membership ended',
  suspended: 'Came home',
  reported: 'Came home after a report',
  removed: 'Removed by a moderator',
  note_held: 'Its note didn’t pass our check',
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function KayakPage({ params }: { params: { id: string } }) {
  const isNew = params.id === 'new'
  const { data, isLoading, isError } = useGetKayakQuery(params.id, { skip: isNew })
  const [light, setLight] = useState<Light>('day')
  useEffect(() => setLight(lightAt(new Date().getHours())), [])

  const home = isNew || data?.state === 'home'

  return (
    <div className="relative h-full overflow-hidden">
      <HarbourWater light={light} zoom={2.6} />
      <div className="absolute inset-0 overflow-y-auto px-4 pb-32 pt-16">
        <div className="mx-auto flex max-w-lg flex-col gap-4">
          <TransitionLink
            href="/harbour"
            className="press inline-flex h-9 w-fit items-center gap-1 rounded-full bg-black/25 pl-2 pr-4 font-ui text-xs text-white backdrop-blur-md"
          >
            <ChevronLeft size={16} aria-hidden="true" /> Harbour
          </TransitionLink>

          {isError && (
            <div className="rounded-3xl glass-strong px-5 py-4 text-center font-ui text-sm text-sand/80">
              We couldn&rsquo;t find this Kayak.
            </div>
          )}

          {(isNew || (data && !isLoading)) && home && <AtMast key={params.id} id={isNew ? null : params.id} kayak={data ?? null} />}
          {data && !isLoading && !home && <AtSea kayak={data} />}
          {data && !isLoading && data.log.some((v) => v.state === 'home' || v.notes.length > 0) && <Log kayak={data} />}
        </div>
      </div>
    </div>
  )
}

// ── At the mast ─────────────────────────────────────────────────────────────
function AtMast({ id, kayak }: { id: string | null; kayak: KayakDetail | null }) {
  const router = useRouter()
  const { data: harbour } = useGetHarbourQuery()
  const [look, setLook] = useState<KayakLook>({ ...DEFAULT_LOOK, ...kayak?.look })
  const [note, setNote] = useState('')
  const [count, setCount] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { check, blocked, gate } = useLiveCheck(note)
  const [save] = useSaveKayakLookMutation()
  const [load] = useLoadGemsMutation()
  const [unload] = useUnloadGemMutation()
  const [launch] = useLaunchKayakMutation()
  const [remove] = useDeleteKayakMutation()

  const keeper = harbour?.keeper ?? false
  const gems = kayak?.gems ?? []
  const dirty = !id || JSON.stringify(look) !== JSON.stringify({ ...DEFAULT_LOOK, ...kayak?.look })
  const available = (harbour?.gems.remaining ?? 0) + (harbour?.gems.stock ?? 0)
  const room = MAX_GEMS - gems.length
  const canLoad = Math.min(room, available)
  const howMany = Math.max(1, Math.min(count, canLoad))

  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const saveLook = () =>
    run(async () => {
      const saved = await save({ id, look }).unwrap()
      if (!id) router.replace(`/harbour/kayak/${saved}` as Route)
    })

  const launchIt = () =>
    run(async () => {
      if (!id || !(await gate())) return
      // Keep any look change the owner made and didn't save separately.
      if (dirty) await save({ id, look }).unwrap()
      await launch({ kayak: id, note: note.trim() }).unwrap()
      router.push('/harbour')
    })

  return (
    <>
      <div className="flex justify-center">
        <KayakArt look={look} aboard={gems.length} className="h-64 w-52 drop-shadow-[0_8px_18px_rgba(0,20,30,0.45)]" />
      </div>

      <section className="flex flex-col gap-5 rounded-3xl glass-strong p-4">
        <h1 className="font-display text-xl text-sand">{id ? 'Your Kayak' : 'Build your Kayak'}</h1>

        <Choice label="Vessel">
          <div className="grid grid-cols-5 gap-1.5">
            {VESSELS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={look.vessel === v}
                aria-label={nameOf(v)}
                title={nameOf(v)}
                onClick={() => setLook({ ...look, vessel: v })}
                className={cn('press rounded-2xl p-1', look.vessel === v ? 'bg-white/15 ring-2 ring-seafoam' : 'hover:bg-white/5')}
              >
                <KayakArt look={{ ...look, vessel: v, deck: {} }} className="aspect-[260/316] w-full" />
              </button>
            ))}
          </div>
        </Choice>

        <Choice label="Colour">
          <div className="grid grid-cols-12 gap-1" role="radiogroup" aria-label="Colour">
            {COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={look.color === c.id}
                aria-label={words(c.id)}
                onClick={() => setLook({ ...look, color: c.id })}
                className={cn(
                  'press relative aspect-square rounded-full shadow-[inset_0_-2px_4px_rgba(0,0,0,0.2)]',
                  look.color === c.id && 'ring-2 ring-sand/80 ring-offset-1 ring-offset-ocean-mid',
                )}
                style={{ background: `hsl(${c.hue} ${c.sat}% ${c.light}%)` }}
              >
                {look.color === c.id && <Check size={12} strokeWidth={3} className="absolute inset-0 m-auto text-black/60" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Choice>

        <Choice label="Pattern">
          <Chips options={PATTERNS} value={look.pattern ?? 'none'} onPick={(pattern) => setLook({ ...look, pattern })} />
        </Choice>

        <Choice label="Paddle">
          <Chips options={PADDLE_STYLES} value={look.paddle} onPick={(paddle) => setLook({ ...look, paddle })} />
        </Choice>

        {DECK_SLOTS.map((slot) => (
          <DeckPicker key={slot} slot={slot} value={look.deck?.[slot] ?? null} onPick={(item) => setLook({ ...look, deck: { ...look.deck, [slot]: item } })} />
        ))}

        {(!id || dirty) && (
          <button
            type="button"
            disabled={busy || !keeper}
            onClick={saveLook}
            className="press w-full rounded-full bg-white/10 py-3 font-ui text-sm font-medium text-sand disabled:opacity-50"
          >
            {id ? 'Save the look' : 'Build it'}
          </button>
        )}
      </section>

      {id && (
        <section className="flex flex-col gap-4 rounded-3xl glass-strong p-4">
          <div>
            <h2 className="font-display text-lg text-sand">Fill it with gems</h2>
            <p className="mt-0.5 font-ui text-xs text-sand/55">
              {available} left this month. Each one is the only one of its kind.
              {harbour?.gems.refill_at ? ` More on ${when(harbour.gems.refill_at)}.` : ''}
            </p>
          </div>

          {gems.length > 0 && (
            <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-6" aria-label="Gems aboard">
              {gems.map((g) => (
                <li key={g.id} className="relative">
                  <GemArt seed={g.seed} className="aspect-square w-full" />
                  <button
                    type="button"
                    aria-label={`Take out ${gemName(g.seed)}`}
                    disabled={busy}
                    onClick={() => run(() => unload({ kayak: id, gem: g.id }).unwrap())}
                    className="press absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white/80"
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {room > 0 && canLoad > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-full bg-black/15 p-1">
                <button
                  type="button"
                  aria-label="Fewer"
                  onClick={() => setCount(Math.max(1, howMany - 1))}
                  className="press flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-sand"
                >
                  <Minus size={14} aria-hidden="true" />
                </button>
                <span aria-live="polite" className="w-7 text-center font-mono text-sm text-sand">
                  {howMany}
                </span>
                <button
                  type="button"
                  aria-label="More"
                  onClick={() => setCount(Math.min(canLoad, howMany + 1))}
                  className="press flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-sand"
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                disabled={busy || !keeper}
                onClick={() => run(() => load({ kayak: id, count: howMany }).unwrap())}
                className="press flex-1 rounded-full bg-white/10 py-2.5 font-ui text-sm font-medium text-sand disabled:opacity-50"
              >
                Get gemstones
              </button>
            </div>
          )}
          {gems.length === 0 && canLoad === 0 && (
            <p className="font-ui text-xs text-sand/60">No gems left this month. They come back on your monthly date.</p>
          )}

          <CheckedText
            value={note}
            onChange={setNote}
            check={check}
            label="A note, or a question, for whoever finds it"
            placeholder="What did the sea teach you?"
            max={NOTE_MAX}
            crisisLead="This note won’t be sent to a stranger."
          />

          <button
            type="button"
            disabled={busy || !keeper || gems.length === 0 || !note.trim() || blocked}
            onClick={launchIt}
            className="press w-full rounded-full bg-seafoam py-3.5 font-ui text-sm font-semibold text-ocean-deep shadow-seafoam transition-[filter,opacity] hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'One moment…' : 'Launch'}
          </button>
          <p className="text-center font-ui text-[11px] leading-relaxed text-sand/45">
            It sets sail slowly, and reaches a random Keeper&rsquo;s harbour. Your note stays anonymous.
          </p>
        </section>
      )}

      {!keeper && harbour && (
        <p className="rounded-2xl bg-black/25 px-4 py-3 text-center font-ui text-xs text-white/85 backdrop-blur-md">
          Your Keeper membership has ended. Renew to launch this Kayak again.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-2xl bg-black/30 px-4 py-3 font-ui text-xs text-coral backdrop-blur-md">
          {error}
        </p>
      )}

      {id && (
        <div className="flex justify-center">
          <ConfirmButton
            confirmLabel="Delete it and its log?"
            onConfirm={() => run(async () => {
              await remove(id).unwrap()
              router.push('/harbour')
            })}
            className="rounded-full bg-black/25 px-4 py-1.5 font-ui text-xs text-white/80 backdrop-blur-md"
          >
            Delete this Kayak
          </ConfirmButton>
        </div>
      )}
    </>
  )
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-ui text-xs text-sand/60">{label}</legend>
      {children}
    </fieldset>
  )
}

function Chips<T extends string>({ options, value, onPick }: { options: readonly T[]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onPick(o)}
          className={cn(
            'press rounded-full px-3 py-1.5 font-ui text-xs capitalize',
            o === value ? 'bg-seafoam text-ocean-deep' : 'bg-white/5 text-sand/75 hover:bg-white/10',
          )}
        >
          {words(o)}
        </button>
      ))}
    </div>
  )
}

const SLOT_LABEL: Record<DeckSlot, string> = { bow: 'At the bow', mid: 'In the middle', stern: 'At the stern' }

function DeckPicker({ slot, value, onPick }: { slot: DeckSlot; value: DeckItem | null; onPick: (v: DeckItem | null) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="font-ui text-xs text-sand/60">{SLOT_LABEL[slot]}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onPick((e.target.value || null) as DeckItem | null)}
        className="field rounded-xl px-3 py-2 font-ui text-xs capitalize text-sand"
      >
        <option value="">Nothing</option>
        {DECK_ITEMS.map((d) => (
          <option key={d} value={d}>
            {words(d)}
          </option>
        ))}
      </select>
    </label>
  )
}

// ── At sea ──────────────────────────────────────────────────────────────────
function AtSea({ kayak }: { kayak: KayakDetail }) {
  const [recall, { isLoading: recalling }] = useRecallKayakMutation()
  const [edit] = useEditNoteMutation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { check, blocked, gate } = useLiveCheck(draft)

  const canEdit = (kayak.state === 'sailing' || kayak.state === 'visiting') && !kayak.edit_pending && (kayak.edits_left ?? 0) > 0

  async function saveEdit() {
    setBusy(true)
    setError(null)
    try {
      if (await gate()) {
        await edit({ kayak: kayak.id, note: draft.trim() }).unwrap()
        setEditing(false)
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex justify-center">
        <KayakArt look={kayak.look} aboard={kayak.gems.length} className="h-56 w-44 drop-shadow-[0_8px_18px_rgba(0,20,30,0.45)]" />
      </div>
      <section className="flex flex-col gap-3 rounded-3xl glass-strong p-4">
        <h1 className="font-display text-xl text-sand">{kayakStatus(kayak)}</h1>
        {kayak.note && (
          <blockquote className="rounded-lg bg-[#FBF3E4] px-4 py-3 font-display text-base leading-snug text-[#2A2622]">{kayak.note}</blockquote>
        )}
        <p className="font-ui text-xs text-sand/55">
          {kayak.gems.length} {kayak.gems.length === 1 ? 'gem' : 'gems'} still aboard.
          {kayak.edit_pending ? ' Your new note is being checked.' : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setDraft(kayak.note ?? '')
                setEditing(true)
              }}
              className="press rounded-full bg-white/10 px-4 py-2 font-ui text-xs font-medium text-sand"
            >
              Change the note ({kayak.edits_left} left)
            </button>
          )}
          {kayak.state !== 'returning' && (
            <ConfirmButton
              confirmLabel="Call it home?"
              disabled={recalling}
              onConfirm={() => recall(kayak.id)}
              className="rounded-full bg-white/10 px-4 py-2 font-ui text-xs font-medium text-sand"
            >
              Call it home
            </ConfirmButton>
          )}
        </div>
      </section>

      <AnimatePresence>
        {editing && (
          <Sheet title="Change the note" onClose={() => setEditing(false)}>
            <div className="flex flex-col gap-3">
              <CheckedText
                value={draft}
                onChange={setDraft}
                check={check}
                label="New note"
                placeholder="What did the sea teach you?"
                max={NOTE_MAX}
                crisisLead="This note won’t be sent to a stranger."
              />
              <p className="font-ui text-[11px] leading-relaxed text-sand/50">
                Once it passes our check it replaces the old note and starts a fresh guestbook. Earlier comments stay in your log.
              </p>
              {error && (
                <p role="alert" className="font-ui text-xs text-coral">
                  {error}
                </p>
              )}
              <button
                type="button"
                disabled={busy || !draft.trim() || draft.trim() === kayak.note || blocked}
                onClick={saveEdit}
                className="press w-full rounded-full bg-seafoam py-3 font-ui text-sm font-semibold text-ocean-deep disabled:opacity-50"
              >
                {busy ? 'One moment…' : 'Send the new note'}
              </button>
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </>
  )
}

// ── The log ─────────────────────────────────────────────────────────────────
const REPORT_REASONS: [ReportReason, string][] = [
  ['sexual', 'Sexual'],
  ['harassment', 'Abusive'],
  ['spam', 'Spam'],
  ['contact', 'Contact info'],
  ['other', 'Other'],
]

function Log({ kayak }: { kayak: KayakDetail }) {
  const [report] = useReportCommentMutation()
  const [reporting, setReporting] = useState<string | null>(null)
  return (
    <section className="flex flex-col gap-4 rounded-3xl glass-strong p-4">
      <h2 className="font-display text-lg text-sand">Its log</h2>
      {kayak.log.map((voyage) => (
        <div key={voyage.id} className="flex flex-col gap-2 border-t border-white/5 pt-3 first:border-0 first:pt-0">
          <p className="font-ui text-[11px] text-sand/45">
            {when(voyage.started_at)}
            {voyage.end_reason ? ` · ${END_REASON[voyage.end_reason] ?? ''}` : ''}
          </p>
          {voyage.notes.map((n) => (
            <div key={n.id} className="flex flex-col gap-1.5">
              <p className="font-display text-sm leading-snug text-sand">{n.body}</p>
              {n.comments.length === 0 && <p className="font-ui text-xs text-sand/40">No comments.</p>}
              {n.comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2 rounded-2xl bg-black/15 px-3 py-2">
                  <p className="flex-1 font-ui text-xs leading-relaxed text-sand/80">{c.body}</p>
                  <button
                    type="button"
                    aria-label="Report this comment"
                    onClick={() => setReporting(c.id)}
                    className="press mt-0.5 shrink-0 text-sand/35 hover:text-coral"
                  >
                    <Flag size={12} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      <AnimatePresence>
        {reporting && (
          <Sheet title="Report this comment" onClose={() => setReporting(null)}>
            <div className="flex flex-col gap-2">
              <p className="font-ui text-xs text-sand/60">
                It disappears for everyone while a moderator looks, and whoever wrote it won&rsquo;t get your Kayaks again.
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Report reason">
                {REPORT_REASONS.map(([reason, label]) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={async () => {
                      await report({ comment: reporting, reason })
                      setReporting(null)
                    }}
                    className="press rounded-full bg-coral/15 px-3 py-1.5 font-ui text-xs font-medium text-coral"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </section>
  )
}
