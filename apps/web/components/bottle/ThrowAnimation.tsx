import { DEFAULT_LOOK, type BottleLook } from '@/lib/dressing'
import { BOTTLE_SHAPES, DEFAULT_NECK, DEFAULT_NOTE, shapeId } from '@/lib/bottleShapes'

// The shared bottle artwork. The old default-export <ThrowAnimation> screen was
// dead code (the live throw is TetheredBottle's arc into SailingSea) and was
// removed; every consumer imports { BottleSVG } from here.

// ─── Shared bottle SVG ───────────────────────────────────────────────────────

/** The view-transition name a bottle carries while it lifts off the shelf. */
export const LIFT_TRANSITION = 'lifting-bottle'

interface BottleSVGProps {
  glowing?: boolean
  width?: number
  height?: number
  /** false draws the bottle open — the shelf's dialog animates its own cork off. */
  corked?: boolean
  /** Atelier dressing (shape, glass tint/edge, wax seal). Omitted = the classic bottle. */
  look?: BottleLook
}

export function BottleSVG({
  glowing = false,
  width = 80,
  height = 120,
  corked = true,
  look,
}: BottleSVGProps) {
  const id = shapeId(look?.shape)
  const shape = BOTTLE_SHAPES[id]
  const note = shape.note ?? DEFAULT_NOTE
  const noteLines = [10, 16, 22].map((at) => note.y + (at / 32) * note.h)
  const inset = (note.w * 5) / 24
  // Clear glass is too faint to show a shape off the classic silhouette.
  const clear = !look?.edge || look.edge === DEFAULT_LOOK.edge
  const edge = clear ? (id === 'classic' ? DEFAULT_LOOK.edge : 'rgba(255,255,255,0.42)') : look.edge
  return (
    <svg
      viewBox="0 0 80 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-shape={id}
      strokeLinejoin="round"
      style={{
        width,
        height,
        filter: glowing
          ? 'drop-shadow(0 0 10px rgba(78,205,196,0.55))'
          : undefined,
      }}
    >
      {corked && (
        <>
          {/* Cork */}
          <rect x="27" y="3" width="26" height="13" rx="4" fill="#C4A882" />
          <rect x="32" y="6" width="16" height="3" rx="1.5" fill="rgba(255,255,255,0.18)" />
          {look?.wax && (
            <>
              {/* Wax seal poured over the cork, a drip down the neck */}
              <path d="M25 4 Q40 -1 55 4 L55 15 Q47 18 44 15 Q42 21 38 15 Q31 18 25 15 Z" fill={look.wax} />
              <circle cx="40" cy="9.5" r="3.6" fill="rgba(255,255,255,0.16)" />
            </>
          )}
        </>
      )}

      {/* Neck */}
      <path d={shape.neck ?? DEFAULT_NECK} fill="rgba(255,255,255,0.10)" stroke={edge} strokeWidth="1" />

      {/* Body */}
      <path d={shape.body} fill="rgba(255,255,255,0.07)" stroke={edge} strokeWidth="1.5" />

      {/* Shine / refraction */}
      {shape.shine?.map((d, i) => (
        <path
          key={d}
          d={d}
          stroke={i === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)'}
          strokeWidth={i === 0 ? 2.5 : 1.5}
          strokeLinecap="round"
        />
      ))}

      {/* Message scroll */}
      <rect x={note.x} y={note.y} width={note.w} height={note.h} rx="3" fill="rgba(247,231,206,0.13)" />
      {noteLines.map((y, i) => (
        <line
          key={y}
          x1={note.x + inset}
          y1={y}
          x2={note.x + note.w - inset * (i === 2 ? 2 : 1)}
          y2={y}
          stroke="rgba(247,231,206,0.22)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}

      {/* Glass tint — seafoam by default */}
      <path d={shape.body} fill={look?.tint ?? DEFAULT_LOOK.tint} />

      {/* Fins, petals, faces */}
      {shape.details?.map((d) => (
        <path key={d} d={d} stroke={edge} strokeOpacity="0.75" strokeWidth="1.1" strokeLinecap="round" />
      ))}
    </svg>
  )
}
