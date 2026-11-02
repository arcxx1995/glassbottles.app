'use client'

import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useAckNoticeMutation, useGetMyNoticesQuery } from '@/store/api/bottleApi'

// What an admin's decision means for this person: a warning, a restriction ending
// or beginning, or how their report turned out (065). Refreshed by the 'notices'
// broadcast, so it doesn't poll. Shown one at a time, oldest first.
export default function AccountNotices() {
  const user = useAppSelector(selectUser)
  const { data } = useGetMyNoticesQuery(undefined, { skip: !user?.id })
  const [ack, { isLoading }] = useAckNoticeMutation()
  const notice = data?.[0]
  if (!notice) return null

  return (
    <div role="status" className="fixed inset-x-0 top-16 z-50 flex justify-center px-4 pt-safe print:hidden">
      <div className="w-full max-w-md rounded-3xl glass-strong px-5 py-4">
        <p className="whitespace-pre-line font-ui text-sm leading-relaxed text-sand/85">{notice.body}</p>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => ack(notice.id)}
          className="press mt-2 font-ui text-xs font-medium text-seafoam disabled:opacity-50"
        >
          Okay
        </button>
      </div>
    </div>
  )
}
