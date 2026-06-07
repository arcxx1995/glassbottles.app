import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import type { TypedUseSelectorHook } from 'react-redux'
import authReducer from './authSlice'
import bottleReducer from './bottleSlice'
import uiReducer from './uiSlice'
import { bottleApi } from './api/bottleApi'
import { authApi } from './api/authApi'
import { notificationApi } from './api/notificationApi'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    bottle: bottleReducer,
    ui: uiReducer,
    [bottleApi.reducerPath]: bottleApi.reducer,
    [authApi.reducerPath]: authApi.reducer,
    [notificationApi.reducerPath]: notificationApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(bottleApi.middleware)
      .concat(authApi.middleware)
      .concat(notificationApi.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
