import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './index'
import type { BottleSendStatus, BottleReceiveStatus } from '@/types'
import type { BottleStyle, Vibe, Weather } from '@/lib/dressing'

interface BottleState {
  sendStatus: BottleSendStatus
  receiveStatus: BottleReceiveStatus
  isAnimating: boolean
  message: string
  // Draft dressing (042). Style is remembered across throws (and per device,
  // lib/dressing saveStyle); weather and vibe belong to one bottle.
  style: BottleStyle
  weather: Weather | null
  vibe: Vibe | null
}

const initialState: BottleState = {
  sendStatus: 'idle',
  receiveStatus: 'idle',
  isAnimating: false,
  message: '',
  style: {},
  weather: null,
  vibe: null,
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
    setStyle(state, action: PayloadAction<BottleStyle>) {
      state.style = action.payload
    },
    setWeather(state, action: PayloadAction<Weather | null>) {
      state.weather = action.payload
    },
    setVibe(state, action: PayloadAction<Vibe | null>) {
      state.vibe = action.payload
    },
    resetBottleState(state) {
      state.sendStatus = 'idle'
      state.receiveStatus = 'idle'
      state.isAnimating = false
      state.message = ''
      state.weather = null
      state.vibe = null
    },
  },
})

export const {
  setSendStatus,
  setReceiveStatus,
  setThrowAnimating,
  setMessage,
  setStyle,
  setWeather,
  setVibe,
  resetBottleState,
} = bottleSlice.actions

export const selectSendStatus = (state: RootState) => state.bottle.sendStatus
export const selectReceiveStatus = (state: RootState) => state.bottle.receiveStatus
export const selectIsAnimating = (state: RootState) => state.bottle.isAnimating
export const selectMessage = (state: RootState) => state.bottle.message
export const selectDraftStyle = (state: RootState) => state.bottle.style
export const selectDraftWeather = (state: RootState) => state.bottle.weather
export const selectDraftVibe = (state: RootState) => state.bottle.vibe

export default bottleSlice.reducer
