import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'

export interface RegisterWhatsAppRequest {
  whatsapp_number: string
}

export interface RegisterWhatsAppResponse {
  registered: boolean
  verified: boolean
  // v2 OTP flow: otp_required=true means the user must call verifyOtp next.
  // v1 immediate flow: otp_required=false, verified=true.
  otp_required: boolean
}

export interface VerifyOtpRequest {
  code: string // 6-digit numeric string
}

export interface VerifyOtpResponse {
  verified: boolean
}

export interface RemoveWhatsAppResponse {
  registered: boolean
  verified: boolean
}

/**
 * notificationApi — RTK Query slice for WhatsApp notification management.
 *
 * Endpoints:
 *   registerWhatsApp  → POST /api/whatsapp/register
 *                         v1: saves + marks verified immediately
 *                         v2 (WHATSAPP_OTP_ENABLED=true): sends OTP, returns otp_required=true
 *   verifyOtp         → POST /api/whatsapp/verify-otp (v2 only)
 *                         Confirms OTP, sets whatsapp_verified=true
 *   removeWhatsApp    → PATCH /api/profile (clears number, sets verified=false)
 *
 * After register/verify/remove, dispatch authApi.util.invalidateTags(['Profile'])
 * from the calling component — cross-slice tag invalidation is not automatic.
 */
export const notificationApi = createApi({
  reducerPath: 'notificationApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    registerWhatsApp: builder.mutation<
      RegisterWhatsAppResponse,
      RegisterWhatsAppRequest
    >({
      query: (body) => ({
        url: '/whatsapp/register',
        method: 'POST',
        body,
      }),
    }),
    verifyOtp: builder.mutation<VerifyOtpResponse, VerifyOtpRequest>({
      query: (body) => ({
        url: '/whatsapp/verify-otp',
        method: 'POST',
        body,
      }),
    }),
    removeWhatsApp: builder.mutation<RemoveWhatsAppResponse, void>({
      query: () => ({
        url: '/profile',
        method: 'PATCH',
        body: { whatsapp_number: null },
      }),
    }),
  }),
})

export const {
  useRegisterWhatsAppMutation,
  useVerifyOtpMutation,
  useRemoveWhatsAppMutation,
} = notificationApi
