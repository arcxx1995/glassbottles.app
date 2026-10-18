import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './index'
import type { Profile } from '@/types'

interface AuthState {
  user: Profile | null
  isLoading: boolean
}

const initialState: AuthState = {
  user: null,
  isLoading: true,
}

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<Profile | null>) {
      state.user = action.payload
      state.isLoading = false
    },
    clearUser(state) {
      state.user = null
      state.isLoading = false
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload
    },
  },
})

export const { setUser, clearUser, setLoading } = authSlice.actions

export const selectUser = (state: RootState) => state.auth.user
export const selectIsAuthenticated = (state: RootState) => state.auth.user !== null
export const selectIsLoading = (state: RootState) => state.auth.isLoading

export default authSlice.reducer
