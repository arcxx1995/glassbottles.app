import { describe, it, expect } from 'vitest'
import { store, purgeSessionState } from './index'
import { setMessage, setSendStatus } from './bottleSlice'
import { dismissReceivedBanner } from './uiSlice'
import { bottleApi } from './api/bottleApi'
import type { Bottle } from '@/types'

// Regression check for the cross-account leak: the store is module-scoped and
// sign-out is a client-side nav, so anything purgeSessionState misses survives
// into the NEXT account on a shared device.
describe('purgeSessionState', () => {
  it('clears draft, UI dismissals, and the RTK Query cache', async () => {
    store.dispatch(setMessage('user A secret draft'))
    store.dispatch(setSendStatus('thrown'))
    store.dispatch(dismissReceivedBanner('bottle-1'))
    await store.dispatch(
      bottleApi.util.upsertQueryData('getReceivedBottles', undefined, [
        { id: 'b1', message: 'user A received secret' } as Bottle,
      ])
    )
    expect(
      Object.keys(store.getState()[bottleApi.reducerPath].queries)
    ).not.toHaveLength(0)

    purgeSessionState(store.dispatch)

    const s = store.getState()
    expect(s.bottle.message).toBe('')
    expect(s.bottle.sendStatus).toBe('idle')
    expect(s.ui.receivedBannerDismissedIds).toEqual([])
    expect(Object.keys(s[bottleApi.reducerPath].queries)).toHaveLength(0)
  })
})
