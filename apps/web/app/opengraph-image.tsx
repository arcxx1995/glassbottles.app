import { ImageResponse } from 'next/og'

export const alt = 'glassbottles — anonymous message in a bottle'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// On-brand share card: night-sky-over-ocean gradient, star field, the bottle
// glyph, and the hero line. Rendered once at build/deploy, served static.
export default function OpengraphImage() {
  // Deterministic pseudo-random star field (no Math.random — stable output).
  const stars = Array.from({ length: 40 }, (_, i) => ({
    left: ((i * 173) % 1200),
    top: ((i * 97) % 280),
    size: 1.5 + (i % 3),
    opacity: 0.35 + ((i % 5) / 10),
  }))

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(180deg, #050B16 0%, #0A1628 55%, #0E2338 100%)',
          position: 'relative',
        }}
      >
        {stars.map((s, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              borderRadius: '50%',
              background: `rgba(247,231,206,${s.opacity})`,
            }}
          />
        ))}

        {/* Bottle glyph */}
        <svg width="120" height="180" viewBox="0 0 160 240" fill="none">
          <rect x="54" y="8" width="52" height="24" rx="8" fill="#C4A882" />
          <path
            d="M60 32 L54 66 L106 66 L100 32 Z"
            fill="rgba(255,255,255,0.10)"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="2"
          />
          <path
            d="M36 66 Q22 98 22 146 Q22 212 80 218 Q138 212 138 146 Q138 98 124 66 Z"
            fill="rgba(78,205,196,0.08)"
            stroke="rgba(78,205,196,0.45)"
            strokeWidth="3"
          />
          <rect x="54" y="96" width="52" height="76" rx="5" fill="rgba(247,231,206,0.14)" />
        </svg>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: 36,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              fontSize: 64,
              color: '#F7E7CE',
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            <div>One bottle. One stranger.</div>
            <div>Every day.</div>
          </div>
          <div style={{ fontSize: 32, color: 'rgba(247,231,206,0.65)', marginTop: 20 }}>
            glassbottles.app — anonymous message in a bottle
          </div>
        </div>

        {/* Sea line */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: 1200,
            height: 90,
            background:
              'linear-gradient(180deg, rgba(78,205,196,0.10) 0%, rgba(78,205,196,0.22) 100%)',
          }}
        />
      </div>
    ),
    size,
  )
}
