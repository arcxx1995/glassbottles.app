import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './index'

interface UIState {
  isReportModalOpen: boolean
  activeBottleId: string | null
  /** Session-local dismissal of the ReceivedBanner, keyed by bottle id.
   *  Banner visibility itself derives from server state (an unread received
   *  bottle exists) — this only hides the toast until reload. The truth
   *  (is_read) lives in the database; a reload resurfaces the banner if the
   *  bottle is still unread. A *different* unread bottle re-shows it. */
  receivedBannerDismissedForId: string | null
}

const initialState: UIState = {
  isReportModalOpen: false,
  activeBottleId: null,
  receivedBannerDismissedForId: null,
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
    dismissReceivedBanner(state, action: PayloadAction<string>) {
      state.receivedBannerDismissedForId = action.payload
    },
  },
})

export const {
  openReportModal,
  closeReportModal,
  setActiveBottleId,
  dismissReceivedBanner,
} = uiSlice.actions

export const selectIsReportModalOpen = (state: RootState) =>
  state.ui.isReportModalOpen
export const selectActiveBottleId = (state: RootState) =>
  state.ui.activeBottleId
export const selectReceivedBannerDismissedForId = (state: RootState) =>
  state.ui.receivedBannerDismissedForId

export default uiSlice.reducer
