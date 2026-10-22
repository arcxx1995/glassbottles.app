'use client'

import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import Sheet from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import { BottleSVG } from './ThrowAnimation'
import KeeperPlans from '@/components/keeper/KeeperPlans'
import { useGetCoinsQuery, useUnlockPieceMutation } from '@/store/api/bottleApi'
import {
  PIECE_KINDS,
  allowedStyle,
  canUse,
  resolveLook,
  saveStyle,
  type AtelierPiece,
  type BottleStyle,
  type PieceKind,
} from '@/lib/dressing'

// The Atelier: dress the bottle a stranger will find. Every piece can be tried
// on — the preview shows it. A Keeper piece only stays on for Keepers (trying
// one opens the membership offer under the preview); a coin piece stays on
// once unlocked with earned coins (049).

const KIND_LABEL: Record<PieceKind, string> = {
  glass: 'Glass',
  seal: 'Seal',
  paper: 'Paper',
  ink: 'Ink',
}

export default function AtelierSheet({
  pieces,
  style,
  isKeeper,
  onSave,
  onClose,
  onBeforeCheckout,
}: {
  pieces: AtelierPiece[]
  style: BottleStyle
  isKeeper: boolean
  onSave: (style: BottleStyle) => void
  onClose: () => void
  /** Called right before leaving for checkout. */
  onBeforeCheckout?: () => void
}) {
  const keeperOn = process.env.NEXT_PUBLIC_KEEPER === 'on'
  const { data: coins } = useGetCoinsQuery()
  const [unlock, { isLoading: unlocking }] = useUnlockPieceMutation()
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const unlocked = coins?.unlocked ?? []
  const balance = coins?.balance ?? 0
  // Keeper pieces only appear while Keeper can actually be bought (or owned);
  // coin pieces are always earnable.
  const shown = useMemo(
    () => pieces.filter((p) => p.tier !== 'keeper' || keeperOn || isKeeper),
    [pieces, keeperOn, isKeeper],
  )
  const [draft, setDraft] = useState<BottleStyle>(style)
  const look = resolveLook(draft, pieces)
  const tried = shown.filter((p) => draft[p.kind] === p.id && !canUse(p, isKeeper, unlocked))
  const keeperLocked = tried.filter((p) => p.tier === 'keeper')
  const coinLocked = tried.filter((p) => p.tier === 'coin')

  return (
    <Sheet title="Dress your bottle" onClose={onClose}>
        {/* Preview: the bottle, and the note as the stranger will read it */}
        <div className="flex items-center gap-4 mb-5">
          <div className="shrink-0">
            <BottleSVG width={64} height={96} glowing look={look} />
          </div>
          <div
            className="flex-1 rounded-2xl border border-white/10 px-4 py-3 transition-colors duration-300"
            style={{ background: look.paper }}
          >
            <p className="font-display text-base leading-relaxed transition-colors duration-300" style={{ color: look.ink }}>
              Whoever finds this — I hope today is gentle with you.
            </p>
          </div>
        </div>

        {PIECE_KINDS.map((kind) => (
          <section key={kind} className="mb-4">
            <p className="font-ui text-[10px] text-sand/45 uppercase tracking-widest mb-2">
              {KIND_LABEL[kind]}
              <span className="normal-case tracking-normal text-sand/50">
                {' · '}
                {pieces.find((p) => p.kind === kind && p.id === (draft[kind] ?? defaultId(pieces, kind)))?.name}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {shown
                .filter((p) => p.kind === kind)
                .map((p) => {
                  const selected = (draft[kind] ?? defaultId(pieces, kind)) === p.id
                  const usable = canUse(p, isKeeper, unlocked)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, [kind]: p.id }))}
                      aria-pressed={selected}
                      aria-label={`${p.name}${usable ? '' : p.tier === 'keeper' ? ' (Keeper)' : ` (${p.coin_cost} coins)`}`}
                      title={p.name}
                      className={cn(
                        'press press-sm relative h-10 w-10 rounded-full border-2 transition-[border-color,transform]',
                        selected ? 'border-seafoam' : 'border-white/10 hover:border-white/30',
                      )}
                    >
                      <Swatch piece={p} />
                      {!usable && p.tier === 'keeper' && (
                        <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-ocean-deep border border-white/15">
                          <Lock size={8} strokeWidth={2} className="text-sand/60" />
                        </span>
                      )}
                      {!usable && p.tier === 'coin' && (
                        <span className="absolute -right-2 -bottom-1 rounded-full bg-ocean-deep border border-white/15 px-1 font-mono text-[8px] leading-4 text-sand/70">
                          {p.coin_cost}✦
                        </span>
                      )}
                    </button>
                  )
                })}
            </div>
          </section>
        ))}

        {keeperLocked.length === 0 && coinLocked.length > 0 ? (
          <div className="mt-2 rounded-2xl border border-white/10 p-4 flex flex-col gap-3">
            <p className="font-ui text-sm text-sand/80 leading-relaxed">
              {coinLocked.map((p) => p.name).join(' and ')} {coinLocked.length > 1 ? 'are' : 'is'} unlocked
              with coins you earn. You have {balance} ✦.
            </p>
            <div className="flex flex-wrap gap-2">
              {coinLocked.map((p) => (
                <button
                  key={p.kind + p.id}
                  type="button"
                  disabled={unlocking || balance < (p.coin_cost ?? Infinity)}
                  onClick={() => {
                    setUnlockError(null)
                    unlock({ kind: p.kind, id: p.id })
                      .unwrap()
                      .catch(() => setUnlockError('Couldn’t unlock it. Please try again.'))
                  }}
                  className="press px-4 py-2 rounded-full bg-seafoam/15 text-seafoam font-ui text-xs font-medium hover:bg-seafoam/25 transition-[background-color,transform] disabled:opacity-40"
                >
                  Unlock {p.name} · {p.coin_cost} ✦
                </button>
              ))}
            </div>
            <p className="font-ui text-[11px] text-sand/40 leading-snug">
              Earn coins when a stranger says your bottle reached them (+3), on every seventh
              day of a tide (+5), and by spotting the whale on your sea (+2).
              {keeperOn && ' Keepers have every piece.'}
            </p>
            {unlockError && <p className="font-ui text-xs text-coral">{unlockError}</p>}
          </div>
        ) : keeperLocked.length > 0 ? (
          <div className="mt-2 rounded-2xl border border-seafoam/20 bg-seafoam/5 p-4 flex flex-col gap-3">
            <p className="font-ui text-sm text-sand/80 leading-relaxed">
              {keeperLocked.map((p) => p.name).join(' and ')} {keeperLocked.length > 1 ? 'are' : 'is'} for
              Keepers. The bottle stays free; Keeper dresses it for the stranger who finds it.
            </p>
            <KeeperPlans
              returnTo="home"
              onBeforeCheckout={() => {
                // Keep the tried-on look: it applies once the membership lands.
                saveStyle(draft)
                onBeforeCheckout?.()
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onSave(allowedStyle(draft, pieces, isKeeper, unlocked))
              onClose()
            }}
            className="press mt-2 w-full py-3.5 rounded-full shadow-seafoam bg-seafoam text-ocean-deep font-ui font-semibold text-sm hover:brightness-110"
          >
            Done
          </button>
        )}
    </Sheet>
  )
}

function defaultId(pieces: AtelierPiece[], kind: PieceKind) {
  return pieces.find((p) => p.kind === kind && p.sort === 0)?.id
}

function Swatch({ piece }: { piece: AtelierPiece }) {
  const { look } = piece
  const fill =
    piece.kind === 'glass'
      ? `linear-gradient(135deg, ${look.edge}, ${look.tint}), #0D2137`
      : piece.kind === 'seal'
        ? (look.wax ?? '#C4A882')
        : piece.kind === 'paper'
          ? look.bg
          : look.color
  return <span className="absolute inset-1 rounded-full" style={{ background: fill }} />
}
