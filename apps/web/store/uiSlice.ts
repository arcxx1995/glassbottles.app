import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './index'

interface UIState {
  isReportModalOpen: boolean
  activeBottleId: string | null
  /** Session-local dismissals of the ReceivedBanner, keyed by bottle id.
   *  Banner visibility derives from server state (an unread received bottle
   *  exists) — this only hides the toast until reload. The truth (is_read)
   *  lives in the database; a reload resurfaces the banner while any bottle is
   *  still unread. Tracked as a SET so that with multiple unread bottles,
   *  dismissing one still surfaces the next (a single id silently buried the
   *  rest — debug report bug 7). */
  receivedBannerDismissedIds: string[]
}

const initialState: UIState = {
  isReportModalOpen: false,
  activeBottleId: null,
  receivedBannerDismissedIds: [],
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
      if (!state.receivedBannerDismissedIds.includes(action.payload)) {
        state.receivedBannerDismissedIds.push(action.payload)
      }
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
export const selectReceivedBannerDismissedIds = (state: RootState) =>
  state.ui.receivedBannerDismissedIds

export default uiSlice.reducer
