'use client'

import { memo, useMemo, type CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import type { SeaWeather } from '@/lib/dressing'

// A current's weather over the water, on the Sea, in the Harbour and in the
// picker's mini seas. Plain CSS loops on small elements (globals.css), no canvas.
// ponytail: fixed particle counts. Add a phone tier if real phones drop frames.

interface Preset {
  count: number
  motion: 'fall' | 'float' | 'glimmer'
  /** Width range in px, and height as a share of width. */
  size: readonly [number, number]
  aspect: number
  /** Seconds per loop. */
  dur: readonly [number, number]
  opacity: readonly [number, number]
  /** One is picked per particle. Any CSS background. */
  fills: readonly string[]
  radius: string
  /** CSS length: sideways travel over one loop. */
  drift: string
  tilt?: number
  spin?: number
  glow?: string
  /** Keeps to the part of the frame above the horizon. */
  sky?: boolean
}

const PRESETS: Record<SeaWeather, Preset> = {
  stars: { count: 34, motion: 'glimmer', size: [1, 2.5], aspect: 1, dur: [3, 8], opacity: [0.4, 0.95], fills: ['#E8F6FF', '#7CF5FF'], radius: '50%', drift: '0', sky: true },
  motes: { count: 16, motion: 'float', size: [2, 4], aspect: 1, dur: [9, 18], opacity: [0.25, 0.6], fills: ['#F5C98A', '#FFE3B8'], radius: '50%', drift: '30px' },
  fog: { count: 5, motion: 'float', size: [320, 520], aspect: 0.35, dur: [40, 70], opacity: [0.7, 1], fills: ['radial-gradient(closest-side, rgba(175,195,209,0.18), transparent)'], radius: '0', drift: '60px' },
  fireflies: { count: 14, motion: 'float', size: [3, 4.5], aspect: 1, dur: [6, 12], opacity: [0.4, 0.95], fills: ['#FFB3D4'], radius: '50%', drift: '40px', glow: '0 0 8px #FF9EC7' },
  snow: { count: 34, motion: 'fall', size: [2, 5], aspect: 1, dur: [10, 20], opacity: [0.5, 0.95], fills: ['#FFFFFF'], radius: '50%', drift: '6vh' },
  rain: { count: 40, motion: 'fall', size: [1, 1.4], aspect: 16, dur: [0.9, 1.5], opacity: [0.5, 1], fills: ['linear-gradient(transparent, rgba(191,227,232,0.55))'], radius: '0', drift: '-15vh', tilt: 8 },
  petals: { count: 14, motion: 'fall', size: [7, 11], aspect: 0.7, dur: [14, 24], opacity: [0.6, 0.9], fills: ['#FFD9C7', '#F9BFC5', '#FFE9DC'], radius: '60% 0 60% 0', drift: '12vh', spin: 540 },
  leaves: { count: 12, motion: 'fall', size: [9, 14], aspect: 0.62, dur: [12, 22], opacity: [0.7, 0.95], fills: ['#E0913A', '#C96F2E', '#F0B04F', '#9E5A28'], radius: '70% 0 70% 0', drift: '14vh', spin: 720 },
}

/** Stable 0–1 noise, so a layer draws the same on every render. */
const noise = (i: number, salt: number) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return v - Math.floor(v)
}
const within = ([min, max]: readonly [number, number], t: number) => min + (max - min) * t

export function particleStyles(weather: SeaWeather, { still, sky = 100, density = 1, scale = 1 }: {
  still: boolean
  sky?: number
  density?: number
  scale?: number
}): CSSProperties[] {
  const p = PRESETS[weather]
  const count = Math.ceil(p.count * density)
  return Array.from({ length: count }, (_, i) => {
    const width = within(p.size, noise(i, 1)) * scale
    const dur = within(p.dur, noise(i, 2))
    const opacity = within(p.opacity, noise(i, 3))
    const spin = p.spin ?? 0
    const tilt = p.tilt ?? 0
    const top = (p.sky ? sky : 100) * noise(i, 4)
    const base: CSSProperties = {
      position: 'absolute',
      left: `${noise(i, 5) * 100}%`,
      width,
      height: width * p.aspect,
      background: p.fills[i % p.fills.length],
      borderRadius: p.radius,
      boxShadow: p.glow,
      opacity,
    }
    if (still) return { ...base, top: `${top}%`, transform: `rotate(${tilt + spin * noise(i, 6)}deg)` }
    const vars = {
      '--gb-a': opacity,
      '--gb-drift': p.drift,
      '--gb-tilt': `${tilt}deg`,
      '--gb-spin': `${spin}deg`,
    } as CSSProperties
    const delay = `-${noise(i, 7) * dur}s`
    if (p.motion === 'fall') return { ...base, ...vars, top: 0, animation: `gb-fall ${dur}s linear ${delay} infinite` }
    const name = p.motion === 'float' ? 'gb-float' : 'gb-glimmer'
    return { ...base, ...vars, top: `${top}%`, animation: `${name} ${dur}s ease-in-out ${delay} infinite alternate` }
  })
}

export default memo(function WeatherLayer({ weather, sky, still = false, density, scale }: {
  weather: SeaWeather
  /** Percent of the frame that is sky. */
  sky?: number
  /** One frozen frame, for previews. Reduced motion also gets this. */
  still?: boolean
  density?: number
  scale?: number
}) {
  const reduced = useReducedMotion() ?? false
  const frozen = still || reduced
  const particles = useMemo(
    () => particleStyles(weather, { still: frozen, sky, density, scale }),
    [weather, frozen, sky, density, scale],
  )
  return (
    <div aria-hidden="true" data-weather={weather} className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((style, i) => (
        <span key={i} style={style} />
      ))}
    </div>
  )
})
