'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Anchor } from 'lucide-react'
import HarbourWater from '@/components/harbour/HarbourWater'
import HarbourScene from '@/components/harbour/HarbourScene'
import KayakEditor from '@/components/harbour/KayakEditor'
import KeeperPlans from '@/components/keeper/KeeperPlans'
import CrisisSupport from '@/components/bottle/CrisisSupport'
import { spring } from '@/components/ui/springs'
import { useGetHarbourQuery } from '@/store/api/bottleApi'
import { lightAt, type Light, type MyKayak } from '@/lib/harbour'

// The Harbour (056): today's twelve kayaks, rafted together. Keepers only;
// everyone else sees the water and a quiet invitation.

/** The next 00:00 UTC, in the viewer's own clock. */
function nextTide() {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function HarbourPage() {
  const { data, isLoading, isError, refetch } = useGetHarbourQuery()
  const [light, setLight] = useState<Light>('day')
  const [editing, setEditing] = useState(false)
  const [tide, setTide] = useState('')
  const [plans, setPlans] = useState(false)

  // Client clock only: the server's hour isn't the viewer's.
  useEffect(() => {
    setLight(lightAt(new Date().getHours()))
    setTide(nextTide())
    if (new URLSearchParams(window.location.search).has('edit')) setEditing(true)
  }, [])

  const mine = data?.mine ?? null
  const keeper = data?.keeper ?? false

  return (
    <div className="relative h-full overflow-hidden">
      <HarbourWater light={light} />

      {data && (
        <HarbourScene kayaks={data.kayaks} mine={mine} night={light === 'night'} ghost={!keeper} />
      )}

      <header className="pointer-events-none relative z-10 flex items-start justify-between gap-3 px-5 pt-6 sm:pt-8">
        <div className="rounded-2xl bg-black/20 px-3.5 py-2 backdrop-blur-md">
          <h1 className="font-display text-xl text-white">The Harbour</h1>
          {keeper && tide && (
            <p className="font-ui text-[11px] text-white/70">
              Today&rsquo;s twelve · <span className="whitespace-nowrap">new kayaks at {tide}</span>
            </p>
          )}
        </div>
        {keeper && mine?.launched && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="press pointer-events-auto shrink-0 whitespace-nowrap rounded-full bg-black/25 px-4 py-2 font-ui text-xs font-medium text-white backdrop-blur-md"
          >
            Your kayak
          </button>
        )}
      </header>

      <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-5 pb-6">
        <AnimatePresence mode="wait">
          {isError ? (
            <Card key="error">
              <p className="font-ui text-sm text-sand/80">The harbour didn&rsquo;t load.</p>
              <button type="button" onClick={() => refetch()} className="press mt-2 font-ui text-xs text-seafoam underline">
                Try again
              </button>
            </Card>
          ) : isLoading || !data ? null : !keeper ? (
            <Card key="preview">
              <p className="font-display text-lg text-sand">A harbour for Keepers</p>
              <p className="mt-1 font-ui text-xs leading-relaxed text-sand/60">
                Each day twelve Keepers&rsquo; kayaks raft together here. Float yours, and visit theirs.
              </p>
              {process.env.NEXT_PUBLIC_KEEPER === 'on' ? (
                plans ? (
                  <div className="mt-3">
                    <KeeperPlans returnTo="harbour" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPlans(true)}
                    className="press mt-3 w-full rounded-full bg-seafoam py-3 font-ui text-sm font-semibold text-ocean-deep"
                  >
                    Become a Keeper
                  </button>
                )
              ) : (
                <p className="mt-2 font-ui text-xs text-sand/45">Opening soon.</p>
              )}
            </Card>
          ) : !mine?.launched ? (
            <motion.button
              key="launch"
              type="button"
              onClick={() => setEditing(true)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={spring}
              className="press inline-flex items-center gap-2 rounded-full bg-seafoam px-6 py-3.5 font-ui text-sm font-semibold text-ocean-deep shadow-seafoam"
            >
              <Anchor size={16} aria-hidden="true" /> Launch my kayak
            </motion.button>
          ) : (
            <Status key="status" mine={mine} empty={data.kayaks.length === 0} tide={tide} onEdit={() => setEditing(true)} />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>{editing && <KayakEditor mine={mine} onClose={() => setEditing(false)} />}</AnimatePresence>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={spring}
      className="w-full max-w-sm rounded-3xl glass-strong px-5 py-4"
    >
      {children}
    </motion.div>
  )
}

/** Why your kayak is or isn't out on the water today. Silent when it's in the ring. */
function Status({ mine, empty, tide, onEdit }: { mine: MyKayak; empty: boolean; tide: string; onEdit: () => void }) {
  if (mine.screen === 'crisis') {
    return (
      <div className="w-full max-w-sm">
        <CrisisSupport lead="Your kayak is staying ashore for now." />
      </div>
    )
  }
  const line = !mine.parked
    ? 'Your kayak is ashore.'
    : mine.screen === 'held'
      ? 'Your handle or bio didn’t pass our check, so your kayak is ashore. Edit your bio to try again.'
      : mine.screen === null
        ? 'Your kayak is being checked. It floats once it passes.'
        : !mine.afloat
          ? 'Your kayak can’t float right now.'
          : !mine.in_ring
            ? `Your kayak is floating, just not among today’s twelve. New kayaks at ${tide}.`
            : null
  if (!line) {
    return empty ? (
      <Card>
        <p className="font-ui text-sm text-sand/70">The harbour is quiet today.</p>
      </Card>
    ) : null
  }
  return (
    <Card>
      <p className="font-ui text-xs leading-relaxed text-sand/75">{line}</p>
      {(!mine.parked || mine.screen === 'held') && (
        <button type="button" onClick={onEdit} className="press mt-2 font-ui text-xs font-medium text-seafoam">
          {mine.parked ? 'Edit your kayak' : 'Float it'}
        </button>
      )}
    </Card>
  )
}
