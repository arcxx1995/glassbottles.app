import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const OWNER_EMAIL = 'arcxx1995@gmail.com'

// POST /api/admin/toggle-plus
// Flips is_plus on the session user's own profile.
// Only works when the session email is OWNER_EMAIL — no secret needed.
export async function POST() {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.email?.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = createServiceClient()

  const { data: profile, error: readError } = await service
    .from('profiles')
    .select('is_plus')
    .eq('id', user.id)
    .single()

  if (readError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const next = !profile.is_plus

  const { error: updateError } = await service
    .from('profiles')
    .update({ is_plus: next })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ is_plus: next })
}
