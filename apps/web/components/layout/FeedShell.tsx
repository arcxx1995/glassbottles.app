'use client'

import ClaimHandle from '@/components/social/ClaimHandle'
import LeftPanel from '@/components/social/LeftPanel'
import RightPanel from '@/components/social/RightPanel'
import { useMe } from '@/components/social/useMe'

/** Old-school three panels: nav + communities | the big middle | the sidebar. */
export default function FeedShell({ children }: { children: React.ReactNode }) {
  const { uid, me, isLoading } = useMe()

  return (
    <div className="mx-auto grid h-full max-w-[84rem] grid-cols-1 gap-5 px-4 pt-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_19rem]">
      <aside className="hidden overflow-y-auto no-scrollbar lg:block"><LeftPanel /></aside>
      <section className="h-full overflow-y-auto no-scrollbar pb-24 lg:pb-8">
        <div className="mx-auto flex max-w-[42rem] flex-col gap-4">
          {isLoading ? <div className="skeleton h-40 rounded-3xl" />
            : !me && uid ? <ClaimHandle userId={uid} /> : children}
        </div>
      </section>
      <aside className="hidden overflow-y-auto no-scrollbar xl:block">{me && <RightPanel />}</aside>
    </div>
  )
}
