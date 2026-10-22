// Opt-in sound + haptics for the moments that deserve them: the throw
// landing in the water, a received bottle uncorking, "your bottle found
// someone", and a light tick when a flick or sheet commits. Off by default; the setting lives in this browser only.
//
// Sounds are synthesized with WebAudio — no audio files to ship or cache.
// navigator.vibrate is Android-only; iOS Safari ignores it silently.

export type Feel = 'splash' | 'pop' | 'chime' | 'tick'

const KEY = 'gb-feel'

export function feelEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setFeelEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* private mode: the toggle just won't persist */
  }
  if (on) void audio()?.resume() // unlock audio inside the toggle's tap (iOS)
}

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  ctx ??= new AudioContext()
  return ctx
}

const VIBRATE: Record<Feel, number[]> = {
  splash: [18, 40, 12],
  pop: [10],
  chime: [8, 60, 8],
  tick: [6],
}

export function feel(kind: Feel) {
  if (!feelEnabled()) return
  navigator.vibrate?.(VIBRATE[kind])
  const ac = audio()
  if (!ac) return
  void ac.resume()
  const t = ac.currentTime
  const out = ac.createGain()
  out.connect(ac.destination)

  if (kind === 'splash') {
    // Filtered noise burst sweeping down: water, roughly.
    const len = Math.floor(ac.sampleRate * 0.6)
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ac.createBufferSource()
    src.buffer = buf
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1800, t)
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.55)
    out.gain.setValueAtTime(0.22, t)
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
    src.connect(lp).connect(out)
    src.start(t)
    return
  }

  // tick: a tiny high click. pop: one quick falling sine. chime: two soft bell partials.
  const [notes, gain, tail]: [number[][], number, number] =
    kind === 'tick'
      ? [[[1600, 900, 0.025]], 0.06, 0.04]
      : kind === 'pop'
        ? [[[520, 180, 0.09]], 0.25, 0.12]
        : [[[880, 880, 0.9], [1320, 1320, 0.7]], 0.08, 1.1]
  out.gain.setValueAtTime(gain, t)
  out.gain.exponentialRampToValueAtTime(0.001, t + tail)
  notes.forEach(([from, to, dur], i) => {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(from, t + i * 0.08)
    osc.frequency.exponentialRampToValueAtTime(to, t + i * 0.08 + dur)
    osc.connect(out)
    osc.start(t + i * 0.08)
    osc.stop(t + i * 0.08 + dur)
  })
}
