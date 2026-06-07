import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { Profile } from '@/types'

export interface UpdateProfileRequest {
  whatsapp_number?: string | null
  timezone?: string
}

export const authApi = createApi({
  reducerPath: 'authApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Profile'],
  endpoints: (builder) => ({
    // Route derives identity from session cookie — no userId param needed.
    getProfile: builder.query<Profile, void>({
      query: () => '/profile',
      providesTags: ['Profile'],
    }),
    updateProfile: builder.mutation<Profile, UpdateProfileRequest>({
      query: (body) => ({
        url: '/profile',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Profile'],
    }),
  }),
})

export const { useGetProfileQuery, useUpdateProfileMutation } = authApi
