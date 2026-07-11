import { ImageResponse } from 'next/og'
import { BottleGlyph, NIGHT_SKY } from './bottle-glyph'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// Full-bleed, no corner radius: iOS applies its own mask, and transparent
// corners would render black on the home screen.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: NIGHT_SKY,
        }}
      >
        <BottleGlyph width={176} height={176} />
      </div>
    ),
    size,
  )
}
