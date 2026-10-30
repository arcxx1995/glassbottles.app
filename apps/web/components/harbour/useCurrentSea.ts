import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { CURRENT_INFO } from '@/lib/dressing'

/** The viewer's current's sea, for Keepers (AppShell recolours the chrome;
 *  this tints the Harbour's water to match). */
export function useCurrentSea(isKeeper: boolean) {
  const current = useAppSelector(selectUser)?.current
  return isKeeper && current ? CURRENT_INFO[current].sea : undefined
}
