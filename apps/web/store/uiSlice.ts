import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './index'

interface UIState {
  isReportModalOpen: boolean
  activeBottleId: string | null
  showReceivedBanner: boolean
}

const initialState: UIState = {
  isReportModalOpen: false,
  activeBottleId: null,
  showReceivedBanner: false,
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
  },
})

export const {
  openReportModal,
  closeReportModal,
  setActiveBottleId,
  setShowReceivedBanner,
} = uiSlice.actions

export const selectIsReportModalOpen = (state: RootState) =>
  state.ui.isReportModalOpen
export const selectActiveBottleId = (state: RootState) =>
  state.ui.activeBottleId
export const selectShowReceivedBanner = (state: RootState) =>
  state.ui.showReceivedBanner

export default uiSlice.reducer
