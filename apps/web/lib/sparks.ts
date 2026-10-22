// The free spark deck (migration 046): questions to write from. Keepers get
// questions from a small AI model tuned to their sky and current; everyone gets these.
// A spark is shown, never written into the bottle.

export const SPARK_DECK = [
  'What small thing went right today?',
  'What are you carrying that you’d like to set down?',
  'What do you wish someone had told you this year?',
  'What made you laugh when you didn’t expect to?',
  'What does a good day look like for you lately?',
  'What are you quietly proud of?',
  'What would you say to someone having a hard night?',
  'What’s something you’re learning slowly?',
  'Who was kind to you recently, and how?',
  'What are you looking forward to, even a little?',
  'What sound or smell feels like home?',
  'What’s one thing you’d tell your younger self?',
  'What helped, the last time things felt heavy?',
  'What’s on your mind right before you fall asleep?',
  'What changed your mind about something?',
  'What tiny ritual keeps you going?',
  'What’s something beautiful you noticed this week?',
  'What are you still figuring out?',
  'What would you want a stranger to know tonight?',
  'What are you grateful for that nobody sees?',
] as const

/** A different question from the one showing (if any). */
export function nextSpark(current?: string | null): string {
  const pool = SPARK_DECK.filter((q) => q !== current)
  return pool[Math.floor(Math.random() * pool.length)]
}
