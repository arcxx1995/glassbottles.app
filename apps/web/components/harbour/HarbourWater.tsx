'use client'

import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import type { Light } from '@/lib/harbour'

// The Harbour's water, seen from straight above: a sandy-bottomed lagoon with
// depth, light caustics on the seabed, fine surface ripple and a sun (or moon)
// glint in the top-left — the reference is an aerial photo of kayaks over
// clear turquoise water. One fragment shader on one canvas.
//
// ponytail: rendered at ~0.6× device pixels — water is soft, and it keeps
// phones cool. No WebGL → the CSS gradient underneath is the water.

type Rgb = [number, number, number]
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb

export const LIGHTS: Record<Light, { deep: string; shallow: string; caustic: string; glint: string; causticAmt: number; glintAmt: number }> = {
  dawn: { deep: '#0F4E66', shallow: '#4AA9B0', caustic: '#FFE3C2', glint: '#FFD2A8', causticAmt: 0.55, glintAmt: 0.8 },
  day: { deep: '#06628A', shallow: '#22C3CF', caustic: '#F4FFFF', glint: '#FFFFFF', causticAmt: 0.85, glintAmt: 1 },
  dusk: { deep: '#173A5E', shallow: '#3C8798', caustic: '#FFC48A', glint: '#FFB070', causticAmt: 0.5, glintAmt: 0.85 },
  night: { deep: '#030F1C', shallow: '#0B2C43', caustic: '#7FB4E0', glint: '#C9DDF2', causticAmt: 0.22, glintAmt: 0.3 },
}

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uZoom;
uniform vec3 uDeep, uShallow, uCaustic, uGlint;
uniform float uCausticAmt, uGlintAmt;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
// Tileable caustic web (after joltz0r's well-known Shadertoy water).
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0, inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
void main() {
  vec2 st = gl_FragCoord.xy / uRes;
  vec2 uv = gl_FragCoord.xy / uRes.y / uZoom;
  float t = uTime;

  float depth = fbm(uv * 1.3 + vec2(t * 0.010, -t * 0.007));
  vec3 col = mix(uDeep, uShallow, smoothstep(0.22, 0.85, depth));

  vec2 w = vec2(fbm(uv * 3.0 + t * 0.05), fbm(uv * 3.0 - t * 0.04));
  float c = caustic(uv * 1.6 + w * 0.35, t * 0.35);
  col += uCaustic * c * uCausticAmt * (0.35 + 0.65 * depth);

  float r = fbm(uv * 14.0 + vec2(t * 0.30, t * 0.20));
  col += uCaustic * smoothstep(0.62, 0.9, r) * 0.07 * uCausticAmt;

  // Glint: falls off by distance in screen units, so a tall phone doesn't
  // stretch it down the whole screen.
  vec2 g = (gl_FragCoord.xy - uRes * vec2(0.08, 0.92)) / min(uRes.x, uRes.y);
  float fall = exp(-dot(g, g) * 7.0);
  float sp = noise(uv * 130.0 + vec2(t * 2.0, -t * 1.3)) * noise(uv * 80.0 - t * 1.7);
  col += uGlint * (fall * 0.3 + smoothstep(0.62, 0.9, sp) * fall * 2.4) * uGlintAmt;

  float v = smoothstep(1.25, 0.35, length(st - 0.5) * 1.4);
  col *= mix(0.74, 1.0, v);
  gl_FragColor = vec4(col, 1.0);
}`

export default function HarbourWater({ light, zoom = 1 }: { light: Light; zoom?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion() ?? false
  const L = LIGHTS[light]

  useEffect(() => {
    const canvas = ref.current
    const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!canvas || !gl) return
    // A lost context (GPU reset, too many contexts) must not leave a blank
    // canvas over the gradient underneath.
    canvas.style.visibility = ''
    const lost = () => {
      canvas.style.visibility = 'hidden'
    }
    canvas.addEventListener('webglcontextlost', lost)

    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      lost() // the CSS gradient is the water
      return
    }
    gl.useProgram(prog)

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const u = (name: string) => gl.getUniformLocation(prog, name)
    gl.uniform3fv(u('uDeep'), hex(L.deep))
    gl.uniform3fv(u('uShallow'), hex(L.shallow))
    gl.uniform3fv(u('uCaustic'), hex(L.caustic))
    gl.uniform3fv(u('uGlint'), hex(L.glint))
    gl.uniform1f(u('uCausticAmt'), L.causticAmt)
    gl.uniform1f(u('uGlintAmt'), L.glintAmt)
    gl.uniform1f(u('uZoom'), zoom)
    const uRes = u('uRes')
    const uTime = u('uTime')

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.6
      canvas.width = Math.round(canvas.clientWidth * scale)
      canvas.height = Math.round(canvas.clientHeight * scale)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uRes, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    const start = performance.now()
    const frame = (now: number) => {
      gl.uniform1f(uTime, 40 + (now - start) / 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!reduced) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('webglcontextlost', lost)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [L, zoom, reduced])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0"
      style={{ background: `radial-gradient(120% 90% at 30% 35%, ${L.shallow}, ${L.deep})` }}
    >
      <canvas ref={ref} className="h-full w-full" />
    </div>
  )
}
