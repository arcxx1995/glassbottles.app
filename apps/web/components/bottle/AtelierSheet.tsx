'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'
import Sheet from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import { BottleSVG } from './ThrowAnimation'
import KeeperPlans from '@/components/keeper/KeeperPlans'
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
// on: the preview shows it. Only Keepers dress (057): trying a piece opens the
// membership offer under the tabs.

const KIND_LABEL: Record<PieceKind, string> = {
  shape: 'Shape',
  glass: 'Glass',
  seal: 'Seal',
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
  // A remembered draft may hold retired pieces; keep what's still on offer,
  // including anything a free user was trying on before checkout.
  const [draft, setDraft] = useState<BottleStyle>(() => allowedStyle(style, pieces, true))
  const [tab, setTab] = useState<PieceKind>('shape')
  const look = resolveLook(draft, pieces)
  const keeperLocked = pieces.filter((p) => draft[p.kind] === p.id && !canUse(p, isKeeper))
  const shown = pieces.filter((p) => p.kind === tab && !p.retired)
  const selectedId = (kind: PieceKind) => draft[kind] ?? pieces.find((p) => p.kind === kind && p.sort === 0)?.id
  const pick = (p: AtelierPiece) => setDraft((d) => ({ ...d, [p.kind]: p.id }))
  const caption = PIECE_KINDS.map((kind) => pieces.find((p) => p.kind === kind && p.id === selectedId(kind))?.name)
    .filter(Boolean)
    .join(' · ')

  const pieceButton = (p: AtelierPiece, className: string, art: React.ReactNode) => {
    const usable = canUse(p, isKeeper)
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => pick(p)}
        aria-pressed={selectedId(p.kind) === p.id}
        aria-label={`${p.name}${usable ? '' : ' (Keeper)'}`}
        title={p.name}
        className={cn(
          'press press-sm relative border-2 transition-[border-color,transform]',
          selectedId(p.kind) === p.id ? 'border-seafoam' : 'border-white/10 hover:border-white/30',
          className,
        )}
      >
        {art}
        {!usable && (
          <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full border border-white/15 bg-ocean-deep">
            <Lock size={8} strokeWidth={2} className="text-sand/60" />
          </span>
        )}
      </button>
    )
  }

  return (
    <Sheet title="Dress your bottle" onClose={onClose}>
      {/* Preview: the bottle as the stranger will find it */}
      <div className="mb-4 flex flex-col items-center gap-2">
        <BottleSVG width={72} height={108} glowing look={look} />
        <p className="font-ui text-xs text-sand/60">{caption}</p>
      </div>

      <div role="tablist" aria-label="What to dress" className="mb-3 flex gap-1 rounded-full bg-white/[0.06] p-1">
        {PIECE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={tab === kind}
            onClick={() => setTab(kind)}
            className={cn(
              'press flex-1 rounded-full py-1.5 font-ui text-sm transition-[background-color,color,transform]',
              tab === kind ? 'bg-seafoam text-ocean-deep' : 'text-sand/70 hover:text-sand',
            )}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      {/* Scrolls on its own, so the preview and Done stay in view. */}
      <div role="tabpanel" aria-label={KIND_LABEL[tab]} className="no-scrollbar mb-4 max-h-[34dvh] overflow-y-auto p-1">
        {tab === 'shape' ? (
          <div className="grid grid-cols-5 gap-2">
            {shown.map((p) =>
              pieceButton(
                p,
                'flex items-center justify-center rounded-xl py-1.5',
                <BottleSVG width={36} height={54} look={{ ...look, shape: p.id }} />,
              ),
            )}
          </div>
        ) : (
          <>
            {/* The plain piece, then two hues to a row: pale, soft and deep of each. */}
            {shown
              .filter((p) => p.sort === 0)
              .map((p) => (
                <div key={p.id} className="mb-2 flex items-center gap-2">
                  {pieceButton(p, 'h-10 w-10 rounded-full', <Swatch piece={p} />)}
                  <span className="font-ui text-xs text-sand/60">{p.name}</span>
                </div>
              ))}
            <div className="grid grid-cols-6 justify-items-center gap-y-2">
              {shown
                .filter((p) => p.sort > 0)
                .map((p) => pieceButton(p, 'h-10 w-10 rounded-full', <Swatch piece={p} />))}
            </div>
          </>
        )}
      </div>

      {keeperLocked.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-seafoam/20 bg-seafoam/5 p-4">
          <p className="font-ui text-sm leading-relaxed text-sand/80">
            {new Intl.ListFormat('en').format(keeperLocked.map((p) => p.name))}{' '}
            {keeperLocked.length > 1 ? 'are' : 'is'} for Keepers. The bottle stays free. Other Keepers will see
            it as you dressed it; everyone else finds the plain bottle.
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
            onSave(allowedStyle(draft, pieces, isKeeper))
            onClose()
          }}
          className="press w-full rounded-full bg-seafoam py-3.5 font-ui text-sm font-semibold text-ocean-deep shadow-seafoam hover:brightness-110"
        >
          Done
        </button>
      )}
    </Sheet>
  )
}

function Swatch({ piece }: { piece: AtelierPiece }) {
  const { look } = piece
  const fill =
    piece.kind === 'glass'
      ? `linear-gradient(135deg, ${look.edge}, ${look.tint}), rgb(var(--c-ocean-mid))`
      : (look.wax ?? '#C4A882')
  return <span className="absolute inset-1 rounded-full" style={{ background: fill }} />
}
