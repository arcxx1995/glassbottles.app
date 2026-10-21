// Single source for landing FAQ copy — rendered in landing-page.tsx and
// emitted as FAQPage JSON-LD in page.tsx. Google requires the schema text to
// match the visible text, so both must read from here.
export const FAQ_ITEMS = [
  {
    q: 'Is it really anonymous?',
    a: 'Yes. A bottle is delivered with no name, no handle and no way to trace it back. Even we can’t show the receiver who threw it.',
  },
  {
    q: 'Can I reply to a bottle?',
    a: 'No. A bottle is a moment, not a conversation. You read it, it stays with you, and tomorrow the ocean moves on.',
  },
  {
    q: 'What if something harmful washes up?',
    a: 'Every bottle passes a safety check before it sails — contact details, cruelty, sexual content and spam stay ashore. And every bottle has a report flag: reported bottles are pulled from the water and repeat senders lose the sea.',
  },
  {
    q: 'Why only one bottle a day?',
    a: 'Scarcity is the soul of it. One honest message beats twenty throwaway ones — and it keeps the ocean worth reading.',
  },
  {
    q: 'Does it cost anything?',
    a:
      process.env.NEXT_PUBLIC_KEEPER === 'on'
        ? 'The bottle is free, always — one message, one stranger, every day. Keeper is an optional membership for beautiful extras, like styled glass and wax seals your stranger receives.'
        : 'No. One message, one stranger, every day — free, always.',
  },
] as const
