// Shared icon art: tattoo-style tilted bottle with a palm island inside —
// white line art on the night-sky gradient. Used by icon.tsx and
// apple-icon.tsx. The bottle is drawn upright and rotated 40°; the sand line
// and palm are counter-rotated so they stay level/vertical in the final image.
export const NIGHT_SKY =
  'linear-gradient(180deg, #050B16 0%, #0A1628 55%, #0E2338 100%)'

const INK = '#FFFFFF'
const BG = '#0A1628'

export function BottleGlyph({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="-25 -25 290 290" fill="none">
      <g transform="rotate(40 118 107)">
        {/* Cork */}
        <rect x="102" y="-4" width="36" height="26" rx="4" fill={BG} stroke={INK} strokeWidth="6" />
        {/* Lip ring */}
        <rect x="96" y="18" width="48" height="14" rx="6" fill={BG} stroke={INK} strokeWidth="6" />
        {/* Bottle outline */}
        <path
          d="M104 30 L104 56 L80 92 Q76 98 76 106 L76 190 Q76 212 98 212 L142 212 Q164 212 164 190 L164 106 Q164 98 160 92 L136 56 L136 30 Z"
          fill="rgba(255,255,255,0.06)"
          stroke={INK}
          strokeWidth="7"
          strokeLinejoin="round"
        />
        {/* X mark on the neck */}
        <path d="M112 38 L128 54 M128 38 L112 54" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        {/* Inner glass line */}
        <rect x="88" y="104" width="64" height="96" rx="10" fill="none" stroke={INK} strokeWidth="3" />

        <clipPath id="bottle-inside">
          <rect x="88" y="104" width="64" height="96" rx="10" />
        </clipPath>
        <g clipPath="url(#bottle-inside)">
          {/* Sand — drawn at -40° so it reads level once the bottle tilts */}
          <path
            d="M88 194 C98 188 104 182 112 174 C116 170 122 168 126 162 C132 154 144 146 152 140 L152 204 L88 204 Z"
            fill={INK}
          />
          {/* Sand speckle */}
          <circle cx="100" cy="196" r="2" fill={BG} />
          <circle cx="112" cy="190" r="2" fill={BG} />
          <circle cx="124" cy="181" r="2" fill={BG} />
          <circle cx="136" cy="171" r="2" fill={BG} />
          <circle cx="144" cy="164" r="2" fill={BG} />
          <circle cx="98" cy="184" r="1.2" fill={INK} />
          <circle cx="118" cy="172" r="1.2" fill={INK} />
          <circle cx="132" cy="158" r="1.2" fill={INK} />
          <circle cx="146" cy="146" r="1.2" fill={INK} />
          {/* Palm — counter-rotated to stand vertical in the final image */}
          <g transform="translate(134 156) rotate(-40)" fill="none" strokeLinecap="round">
            <path d="M0 4 Q6 -16 3 -36" stroke={INK} strokeWidth="5.5" />
            <path d="M3 -36 Q-12 -44 -22 -38" stroke={INK} strokeWidth="5" />
            <path d="M3 -36 Q-9 -52 -19 -50" stroke={INK} strokeWidth="5" />
            <path d="M3 -36 Q-1 -56 -9 -60" stroke={INK} strokeWidth="5" />
            <path d="M3 -36 Q18 -46 28 -40" stroke={INK} strokeWidth="5" />
            <path d="M3 -36 Q14 -54 24 -52" stroke={INK} strokeWidth="5" />
          </g>
        </g>
      </g>
    </svg>
  )
}
