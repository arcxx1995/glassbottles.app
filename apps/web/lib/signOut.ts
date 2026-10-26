import { createClient } from '@/lib/supabase/client'
import { disablePush } from '@/lib/push'

// scope:'local' clears the session from the browser immediately with no
// Auth-server round-trip. The default global scope revokes the refresh token
// server-side first, so the await blocked navigation for the whole network
// call (the slow sign-out). Local is instant; the token expires server-side
// on its own, and onAuthStateChange(SIGNED_OUT) still clears Redux.
// A shared device shouldn't keep getting this account's pushes.
export async function signOut(go: (path: '/sign-in') => void) {
  await disablePush().catch(() => 'off')
  await createClient().auth.signOut({ scope: 'local' })
  go('/sign-in')
}
