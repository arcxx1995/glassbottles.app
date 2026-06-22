import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// POST /api/admin/set-plus
// Manually grant or revoke Plus for a user by email.
// Requires header: x-admin-secret matching ADMIN_SECRET env var.
// Body: { email: string, is_plus: boolean }
//
// Example:
//   curl -X POST https://test.glassbottles.app/api/admin/set-plus \
//     -H "x-admin-secret: <secret>" \
//     -H "Content-Type: application/json" \
//     -d '{"email":"user@example.com","is_plus":true}'
export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  if (req.headers.get('x-admin-secret') !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { email, is_plus } = body as { email?: unknown; is_plus?: unknown }

  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }
  if (typeof is_plus !== 'boolean') {
    return NextResponse.json({ error: 'is_plus must be boolean' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Resolve email → user id via auth admin API
  const { data: listData, error: listError } =
    await supabase.auth.admin.listUsers({ perPage: 1000 })

  if (listError) {
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 })
  }

  const authUser = listData.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  )
  if (!authUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ is_plus })
    .eq('id', authUser.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, user_id: authUser.id, email, is_plus })
}
