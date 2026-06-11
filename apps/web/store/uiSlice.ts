import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './index'

interface UIState {
  isReportModalOpen: boolean
  activeBottleId: string | null
  /** Auto-dismissing toast: a bottle arrived in this user's inbox. */
  showReceivedBanner: boolean
  /** Persistent toast: one of this user's sent bottles was matched to a stranger.
   *  Stays until the user dismisses it (no auto-dismiss). */
  showDeliveredBanner: boolean
}

const initialState: UIState = {
  isReportModalOpen: false,
  activeBottleId: null,
  showReceivedBanner: false,
  showDeliveredBanner: false,
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    openReportModal(state, action: PayloadAction<string>) {
      state.isReportModalOpen = true
      state.activeBottleId = action.payload
    },
    closeReportModal(state) {
      state.isReportModalOpen = false
      state.activeBottleId = null
    },
    setActiveBottleId(state, action: PayloadAction<string | null>) {
      state.activeBottleId = action.payload
    },
    setShowReceivedBanner(state, action: PayloadAction<boolean>) {
      state.showReceivedBanner = action.payload
    },
    setShowDeliveredBanner(state, action: PayloadAction<boolean>) {
      state.showDeliveredBanner = action.payload
    },
  },
})

export const {
  openReportModal,
  closeReportModal,
  setActiveBottleId,
  setShowReceivedBanner,
  setShowDeliveredBanner,
} = uiSlice.actions

export const selectIsReportModalOpen = (state: RootState) =>
  state.ui.isReportModalOpen
export const selectActiveBottleId = (state: RootState) =>
  state.ui.activeBottleId
export const selectShowReceivedBanner = (state: RootState) =>
  state.ui.showReceivedBanner
export const selectShowDeliveredBanner = (state: RootState) =>
  state.ui.showDeliveredBanner

export default uiSlice.reducer
