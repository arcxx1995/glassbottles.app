import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import { useDispatch, useSelector } from 'react-redux'
import type { TypedUseSelectorHook } from 'react-redux'
import authReducer from './authSlice'
import bottleReducer, { resetBottleState } from './bottleSlice'
import uiReducer, { resetUiState } from './uiSlice'
import { bottleApi } from './api/bottleApi'
import { authApi } from './api/authApi'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    bottle: bottleReducer,
    ui: uiReducer,
    [bottleApi.reducerPath]: bottleApi.reducer,
    [authApi.reducerPath]: authApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(bottleApi.middleware)
      .concat(authApi.middleware),
})

// Wires window focus/online state into RTK Query so `skipPollingIfUnfocused`
// actually skips on hidden tabs (without this it has no focus signal and polls
// regardless — wasting the throttle the no-Vercel-polling rule depends on).
setupListeners(store.dispatch)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

/**
 * Purge everything session-scoped from the store. The store is module-scoped
 * and sign-out is a client-side navigation (no reload), so without this the
 * RTK Query cache (received bottles, status, banners, profile), the draft
 * message, and dismissed-banner ids all survive into the NEXT account on a
 * shared device. Called by AuthProvider on SIGNED_OUT — the single shared
 * path for explicit sign-out and account deletion.
 */
export function purgeSessionState(dispatch: AppDispatch) {
  dispatch(bottleApi.util.resetApiState())
  dispatch(authApi.util.resetApiState())
  dispatch(resetBottleState())
  dispatch(resetUiState())
}

export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
