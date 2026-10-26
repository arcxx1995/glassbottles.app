import { NextResponse } from 'next/server'

// Node runtime (Edge is deprecated); dynamic so the timestamp is live.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { status: 200 }
  )
}
