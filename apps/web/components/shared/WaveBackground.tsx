// Server-renderable: every loop here is a CSS keyframe (globals.css), so the
// compositor plays it with no JS.

const WAVE_LAYERS = [
  { speed: 8, offset: 0, opacity: 0.14, bottom: 0 },
  { speed: 11, offset: 1.5, opacity: 0.09, bottom: 20 },
  { speed: 14, offset: 3.0, opacity: 0.06, bottom: 40 },
] as const

export default function WaveBackground() {
  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      aria-hidden="true"
    >
      {/* Gradient base */}
      <div className="absolute inset-0 bg-gradient-to-b from-ocean-deep via-[#0C1C2E] to-[#091520]" />

      {/* Ambient radial glow */}
      <div
        className="absolute rounded-full"
        style={{
          top: '-10%',
          left: '20%',
          width: '60vw',
          height: '60vw',
          background:
            'radial-gradient(circle, rgba(78,205,196,0.05) 0%, transparent 65%)',
          animation: 'gb-pulse 7s ease-in-out infinite',
        }}
      />

      {/* Animated wave layers */}
      {WAVE_LAYERS.map((layer, i) => (
        <div
          key={i}
          className="absolute left-0"
          style={{
            bottom: layer.bottom,
            width: '200%',
            height: '80px',
            opacity: layer.opacity,
            animation: `gb-drift ${layer.speed}s linear ${layer.offset}s infinite`,
          }}
        >
          <svg
            viewBox="0 0 1440 80"
            preserveAspectRatio="none"
            style={{ width: '100%', height: '80px' }}
          >
            <path
              d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,80 L0,80 Z"
              fill="#4ECDC4"
            />
          </svg>
        </div>
      ))}

      {/* Bottom solid ocean fill */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: '48px', background: 'rgba(78,205,196,0.04)' }}
      />
    </div>
  )
}
