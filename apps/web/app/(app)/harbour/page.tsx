'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { Anchor } from 'lucide-react'
import HarbourWater from '@/components/harbour/HarbourWater'
import HarbourScene from '@/components/harbour/HarbourScene'
import { heldCopy } from '@/components/harbour/CheckedText'
import KayakArt from '@/components/harbour/KayakArt'
import KeeperPlans from '@/components/keeper/KeeperPlans'
import CrisisSupport from '@/components/bottle/CrisisSupport'
import Sheet from '@/components/ui/Sheet'
import { TransitionLink } from '@/components/ui/TransitionLink'
import { spring } from '@/components/ui/springs'
import { useAckKayakNoticeMutation, useGetHarbourQuery } from '@/store/api/bottleApi'
import { MAX_KAYAKS, atMast, kayakStatus, lightAt, type KayakNotice, type Light } from '@/lib/harbour'
import { useCurrentSea } from '@/components/shared/useCurrentSea'
import WeatherLayer from '@/components/shared/WeatherLayer'

// The Harbour (063): the same screen for everyone. Keepers' Kayaks tie up at the
// mast or sail off; visiting Kayaks float in. Free members see the water and the
// mast, and "Build your Kayak" opens the plans. No demo boats, no fake activity.

export default function HarbourPage() {
  const router = useRouter()
  // A read of a Kayak clears its new-comment marker, so don't trust the cache here.
  const { data, isLoading, isError, refetch } = useGetHarbourQuery(undefined, { refetchOnMountOrArgChange: true })
  const [light, setLight] = useState<Light>('day')
  const [plans, setPlans] = useState(false)

  // Client clock only: the server's hour isn't the viewer's.
  useEffect(() => setLight(lightAt(new Date().getHours())), [])

  const keeper = data?.keeper ?? false
  const tint = useCurrentSea(keeper)
  const kayaks = data?.kayaks ?? []
  const atSea = kayaks.filter((k) => !atMast(k))
  const canBuild = kayaks.length < MAX_KAYAKS

  return (
    <div className="relative h-full overflow-hidden">
      <HarbourWater light={light} tint={tint} />

      {data && <HarbourScene kayaks={kayaks} visitors={data.visitors} treasure={data.treasure} />}
      {tint && <WeatherLayer weather={tint.weather} />}

      <header className="pointer-events-none relative z-10 px-5 pt-16">
        <div className="inline-block rounded-2xl bg-black/20 px-3.5 py-2 backdrop-blur-md">
          <h1 className="font-display text-xl text-white">The Harbour</h1>
          {data && data.visitors.length > 0 && (
            <p className="font-ui text-[11px] text-white/70">
              {data.visitors.length === 1 ? 'A Kayak is visiting' : `${data.visitors.length} Kayaks are visiting`}
            </p>
          )}
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-5 pb-6">
        {isError ? (
          <Card>
            <p className="font-ui text-sm text-sand/80">The harbour didn&rsquo;t load.</p>
            <button type="button" onClick={() => refetch()} className="press mt-2 font-ui text-xs text-seafoam underline">
              Try again
            </button>
          </Card>
        ) : isLoading || !data ? null : (
          <>
            {data.notices.map((n) => (
              <Notice key={n.id} notice={n} />
            ))}
            {atSea.map((k) => (
              <TransitionLink
                key={k.id}
                href={`/harbour/kayak/${k.id}` as Route}
                className="press flex w-full max-w-sm items-center gap-3 rounded-2xl bg-black/30 py-2 pl-2 pr-4 backdrop-blur-md"
              >
                <KayakArt look={k.look} className="h-10 w-8 shrink-0" />
                <span className="flex-1 font-ui text-xs text-white/90">{kayakStatus(k)}</span>
                {k.new_comments > 0 && (
                  <span className="rounded-full bg-seafoam px-1.5 py-0.5 font-ui text-[10px] font-semibold text-ocean-deep">
                    {k.new_comments}
                  </span>
                )}
              </TransitionLink>
            ))}
            {canBuild && (
              <motion.button
                type="button"
                onClick={() => (keeper ? router.push('/harbour/kayak/new' as Route) : setPlans(true))}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                className="press inline-flex items-center gap-2 rounded-full bg-seafoam px-6 py-3.5 font-ui text-sm font-semibold text-ocean-deep shadow-seafoam"
              >
                <Anchor size={16} aria-hidden="true" /> {kayaks.length === 0 ? 'Build your Kayak' : 'Build another Kayak'}
              </motion.button>
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {plans && (
          <Sheet title="Kayaks are for Keepers" onClose={() => setPlans(false)}>
            <div className="flex flex-col gap-4">
              <p className="font-ui text-sm leading-relaxed text-sand/70">
                Build a Kayak, fill it with one-of-a-kind gems, and send it out with a note. It visits one Keeper at a
                time, and each one can take a gem for a word in return. Kayaks visit your harbour too.
              </p>
              {process.env.NEXT_PUBLIC_KEEPER === 'on' ? (
                <KeeperPlans returnTo="harbour" />
              ) : (
                <p className="font-ui text-xs text-sand/45">Opening soon.</p>
              )}
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="w-full max-w-sm rounded-3xl glass-strong px-5 py-4"
    >
      {children}
    </motion.div>
  )
}

/** A note or comment the screen held. Crisis gets people to talk to, not a rule. */
function Notice({ notice }: { notice: KayakNotice }) {
  const [ack] = useAckKayakNoticeMutation()
  const dismiss = () => ack({ kind: notice.kind, id: notice.id })
  if (notice.reason === 'crisis') {
    return (
      <div className="w-full max-w-sm">
        <CrisisSupport
          lead={notice.kind === 'note' ? 'Your note stayed with you, and your Kayak is still at the mast.' : 'Your comment wasn’t shared.'}
          onDismiss={dismiss}
        />
      </div>
    )
  }
  return (
    <Card>
      <p className="font-ui text-xs leading-relaxed text-sand/75">
        {notice.reason === 'review' || notice.reason === 'minor'
          ? notice.kind === 'note'
            ? 'Your note is waiting for a closer look, so it didn’t go out.'
            : 'Your comment is waiting for a closer look. Your gem stays on its way until then.'
          : notice.kind === 'note'
            ? 'Your note didn’t pass our check, so it didn’t go out.'
            : 'Your comment didn’t pass our check, so it wasn’t shared and the gem went back.'}{' '}
        {notice.reason !== 'review' && heldCopy(notice.reason)}
      </p>
      <p className="mt-2 line-clamp-2 font-display text-sm text-sand/60">{notice.body}</p>
      <button type="button" onClick={dismiss} className="press mt-2 font-ui text-xs font-medium text-seafoam">
        Okay
      </button>
    </Card>
  )
}
