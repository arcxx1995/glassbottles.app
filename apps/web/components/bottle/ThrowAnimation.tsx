// The shared bottle artwork. The old default-export <ThrowAnimation> screen was
// dead code (the live throw is TetheredBottle's arc into SailingSea) and was
// removed; every consumer imports { BottleSVG } from here.

// ─── Shared bottle SVG ───────────────────────────────────────────────────────

interface BottleSVGProps {
  glowing?: boolean
  width?: number
  height?: number
}

export function BottleSVG({
  glowing = false,
  width = 80,
  height = 120,
}: BottleSVGProps) {
  return (
    <svg
      viewBox="0 0 80 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        width,
        height,
        filter: glowing
          ? 'drop-shadow(0 0 10px rgba(78,205,196,0.55))'
          : undefined,
      }}
    >
      {/* Cork */}
      <rect x="27" y="3" width="26" height="13" rx="4" fill="#C4A882" />
      <rect x="32" y="6" width="16" height="3" rx="1.5" fill="rgba(255,255,255,0.18)" />

      {/* Neck */}
      <path
        d="M30 16 L27 34 L53 34 L50 16 Z"
        fill="rgba(255,255,255,0.10)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
      />

      {/* Body */}
      <path
        d="M19 34 Q11 52 11 72 Q11 104 40 108 Q69 104 69 72 Q69 52 61 34 Z"
        fill="rgba(255,255,255,0.07)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
      />

      {/* Shine / refraction */}
      <path
        d="M20 42 Q17 58 17 72"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M26 36 Q23 46 23 56"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Message scroll */}
      <rect x="28" y="52" width="24" height="32" rx="3" fill="rgba(247,231,206,0.13)" />
      <line x1="33" y1="62" x2="47" y2="62" stroke="rgba(247,231,206,0.22)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="33" y1="68" x2="47" y2="68" stroke="rgba(247,231,206,0.22)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="33" y1="74" x2="42" y2="74" stroke="rgba(247,231,206,0.22)" strokeWidth="1.5" strokeLinecap="round" />

      {/* Seafoam tint */}
      <path
        d="M19 34 Q11 52 11 72 Q11 104 40 108 Q69 104 69 72 Q69 52 61 34 Z"
        fill="rgba(78,205,196,0.04)"
      />
    </svg>
  )
}
