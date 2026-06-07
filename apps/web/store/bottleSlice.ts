import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './index'
import type { BottleSendStatus, BottleReceiveStatus } from '@/types'

interface BottleState {
  sendStatus: BottleSendStatus
  receiveStatus: BottleReceiveStatus
  isAnimating: boolean
  message: string
}

const initialState: BottleState = {
  sendStatus: 'idle',
  receiveStatus: 'idle',
  isAnimating: false,
  message: '',
}

export const bottleSlice = createSlice({
  name: 'bottle',
  initialState,
  reducers: {
    setSendStatus(state, action: PayloadAction<BottleSendStatus>) {
      state.sendStatus = action.payload
    },
    setReceiveStatus(state, action: PayloadAction<BottleReceiveStatus>) {
      state.receiveStatus = action.payload
    },
    setThrowAnimating(state, action: PayloadAction<boolean>) {
      state.isAnimating = action.payload
    },
    setMessage(state, action: PayloadAction<string>) {
      state.message = action.payload
    },
    resetBottleState(state) {
      state.sendStatus = 'idle'
      state.receiveStatus = 'idle'
      state.isAnimating = false
      state.message = ''
    },
  },
})

export const {
  setSendStatus,
  setReceiveStatus,
  setThrowAnimating,
  setMessage,
  resetBottleState,
} = bottleSlice.actions

export const selectSendStatus = (state: RootState) => state.bottle.sendStatus
export const selectReceiveStatus = (state: RootState) => state.bottle.receiveStatus
export const selectIsAnimating = (state: RootState) => state.bottle.isAnimating
export const selectMessage = (state: RootState) => state.bottle.message

export default bottleSlice.reducer
