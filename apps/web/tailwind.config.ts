import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'ocean-deep': '#0A1628',
        'ocean-mid': '#0D2137',
        seafoam: '#4ECDC4',
        sand: '#F7E7CE',
        coral: '#FF6B6B',
        glass: 'rgba(255,255,255,0.08)',
        foam: 'rgba(255,255,255,0.04)',
      },
      fontFamily: {
        display: ['Playfair Display', 'Georgia', 'serif'],
        ui: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      keyframes: {
        'wave-ambient': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'bottle-bob': {
          '0%, 100%': { transform: 'translateY(0px) rotate(-1deg)' },
          '50%': { transform: 'translateY(-6px) rotate(1deg)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'throw-arc': {
          '0%': { transform: 'translateX(0) translateY(0) rotate(0deg)', opacity: '1' },
          '60%': { transform: 'translateX(120px) translateY(-80px) rotate(20deg)', opacity: '1' },
          '100%': { transform: 'translateX(200px) translateY(60px) rotate(45deg)', opacity: '0' },
        },
      },
      animation: {
        'wave-ambient': 'wave-ambient 4s ease-in-out infinite',
        'bottle-bob': 'bottle-bob 3s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out forwards',
        'throw-arc': 'throw-arc 0.8s cubic-bezier(0.25,0.46,0.45,0.94) forwards',
      },
      transitionTimingFunction: {
        'throw-arc': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      },
    },
  },
  plugins: [],
}

export default config
