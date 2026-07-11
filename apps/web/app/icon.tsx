import { ImageResponse } from 'next/og'
import { BottleGlyph, NIGHT_SKY } from './bottle-glyph'

// One route, three sizes: 32 is the favicon, 192/512 back the PWA manifest
// (manifest.ts points at /icon/192 and /icon/512).
const SIZES = [32, 192, 512]

export function generateImageMetadata() {
  return SIZES.map((s) => ({
    id: String(s),
    size: { width: s, height: s },
    contentType: 'image/png',
  }))
}

export default function Icon({ id }: { id: string }) {
  const s = Number(id)
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
          // Rounded corners only at tab size; manifest icons stay full-bleed
          // so launchers/OS masks don't show transparent corners.
          borderRadius: s <= 32 ? 6 : 0,
        }}
      >
        <BottleGlyph width={s} height={s} />
      </div>
    ),
    { width: s, height: s },
  )
}
