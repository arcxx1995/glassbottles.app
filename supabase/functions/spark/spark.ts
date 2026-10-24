// Pure pieces of the spark function (no Deno or network imports), tested from
// apps/web/lib/spark.test.ts.

const WEATHERS = ['stormy', 'foggy', 'calm', 'sunny'] as const
const VIBES = ['venting', 'small_win', 'wondering', 'grateful'] as const
const CURRENTS = ['night_owl', 'quiet_wins', 'heavy_water', 'busy_minds'] as const

const VIBE_WORDS: Record<(typeof VIBES)[number], string> = {
  venting: 'needs to let something out',
  small_win: 'has a small win to share',
  wondering: 'is wondering about something',
  grateful: 'is feeling grateful',
}
const CURRENT_WORDS: Record<(typeof CURRENTS)[number], string> = {
  night_owl: 'late-night thoughts',
  quiet_wins: 'small good things',
  heavy_water: 'grief and hard days',
  busy_minds: 'racing thoughts',
}

export interface SparkContext {
  weather?: (typeof WEATHERS)[number]
  vibe?: (typeof VIBES)[number]
  current?: (typeof CURRENTS)[number]
}

/** Keeps only known values — the body is user input. */
export function sparkContext(body: unknown): SparkContext {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const pick = <T extends string>(v: unknown, list: readonly T[]) =>
    list.includes(v as T) ? (v as T) : undefined
  return {
    weather: pick(b.weather, WEATHERS),
    vibe: pick(b.vibe, VIBES),
    current: pick(b.current, CURRENTS),
  }
}

export const SPARK_PROMPT = `You offer one gentle question to help someone begin writing a short, honest, anonymous note to a stranger on glassbottles. The writer stays the author: never write the note, never suggest its content, never ask for names, places, or anything that could identify them.

The question should:
- be open, warm, and easy to start answering
- be 18 words or fewer, with no preamble and no quotation marks
- fit the writer's mood if one is given, without naming the app`

export function sparkRequest(ctx: SparkContext): string {
  const parts: string[] = []
  if (ctx.weather) parts.push(`Their sky today feels ${ctx.weather}.`)
  if (ctx.vibe) parts.push(`The writer ${VIBE_WORDS[ctx.vibe]}.`)
  if (ctx.current) parts.push(`They sail the current for ${CURRENT_WORDS[ctx.current]}.`)
  return parts.length ? parts.join(' ') : 'No mood given.'
}

export const SPARK_SCHEMA = {
  type: 'object',
  properties: { question: { type: 'string' } },
  required: ['question'],
  additionalProperties: false,
} as const

/** A usable question, or null (the app falls back to its static deck). */
export function cleanQuestion(raw: unknown): string | null {
  const q = (raw as { question?: unknown } | null)?.question
  if (typeof q !== 'string') return null
  const t = q.trim().replace(/^["“']|["”']$/g, '')
  if (!t || t.length > 160 || t.split(/\s+/).length > 24) return null
  return t
}
