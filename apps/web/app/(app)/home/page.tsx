'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  setSendStatus,
  setThrowAnimating,
  setMessage,
  selectSendStatus,
  selectMessage,
} from '@/store/bottleSlice'
import { selectUser } from '@/store/authSlice'
import {
  useSendBottleMutation,
  useGetTodayBottleStatusQuery,
} from '@/store/api/bottleApi'
import DailyTimer from '@/components/shared/DailyTimer'
import MessageEditor from '@/components/bottle/MessageEditor'
import BottleSkeleton from '@/components/shared/BottleSkeleton'
import OceanCounter from '@/components/shared/OceanCounter'
import SailingSea from '@/components/bottle/SailingSea'
import TetheredBottle from '@/components/bottle/TetheredBottle'

export default function HomePage() {
  const dispatch = useAppDispatch()
  const sendStatus = useAppSelector(selectSendStatus)
  const message = useAppSelector(selectMessage)
  const user = useAppSelector(selectUser)

  const [sendBottle] = useSendBottleMutation()
  const [sendError, setSendError] = useState(false)

  // Restore send state after page refresh — a user who already sent today
  // should land on the sailing sea, not the "Your bottle awaits" idle screen.
  const { data: todayStatus, isLoading: isStatusLoading } =
    useGetTodayBottleStatusQuery(undefined, { skip: !user?.id })

  // All of the user's undelivered bottles, floating together in the sea.
  const sailingBottles = todayStatus?.sailingBottles ?? []
  const hasSent = todayStatus?.quota.has_sent ?? false
  // status route fetches at most 21 — length 21 means "at or above the ceiling".
  const atCeiling = sailingBottles.length >= 21

  // Idle (throw entry) shows only when the user hasn't sent today AND the sea
  // isn't full. Otherwise → sailing. When a bottle is delivered, the realtime
  // listener invalidates BottleStatus; the refetched count drops below 21 and
  // this effect flips back to idle automatically (no manual refresh).
  useEffect(() => {
    if (!todayStatus) return
    const shouldSail = hasSent || atCeiling
    if (shouldSail && sendStatus === 'idle') {
      dispatch(setSendStatus('thrown'))
    } else if (!shouldSail && sendStatus === 'thrown') {
      dispatch(setSendStatus('idle'))
    }
  }, [todayStatus, hasSent, atCeiling, sendStatus, dispatch])

  // Set when a send fails so the drop animation does NOT resolve into the
  // sailing sea (debug report bug 9). Without this, every failed throw flashed
  // thrown → sailing → idle before settling back.
  const sendFailedRef = useRef(false)

  async function handleThrow() {
    sendFailedRef.current = false
    setSendError(false)
    dispatch(setSendStatus('throwing'))
    dispatch(setThrowAnimating(true))
    try {
      await sendBottle({ message }).unwrap()
      // Success — clear the draft so the editor isn't pre-filled with the sent
      // message on the next idle screen (debug report bug 8).
      dispatch(setMessage(''))
    } catch {
      sendFailedRef.current = true
      setSendError(true)
      // If the drop already finished (it set 'thrown'), correct back to idle.
      dispatch(setThrowAnimating(false))
      dispatch(setSendStatus('idle'))
    }
  }

  // Fired when the bottle finishes dropping off its tether into the sea.
  function handleDropComplete() {
    dispatch(setThrowAnimating(false))
    // Don't transition into the sea if the send failed — stay on idle so the
    // user can retry with their message intact.
    if (sendFailedRef.current) {
      sendFailedRef.current = false
      dispatch(setSendStatus('idle'))
      return
    }
    dispatch(setSendStatus('thrown'))
  }

  // Show skeleton while we wait for server state so we don't flash
  // "Your bottle awaits" to a user who already sent today
  const isInitializing = !!user?.id && isStatusLoading && !todayStatus

  return (
    <div className="flex flex-col items-center min-h-screen pt-14 px-5">
      {/* Full-viewport sea background, present across the whole throw flow so the
          idle pier, the drop, and the sailing sea share one continuous ocean.
          Floating bottles only appear once sailing (idle/throwing pass []).
          Mounted here (not inside the animated stage) so its `fixed` positioning
          stays relative to the viewport rather than a transformed ancestor. */}
      {!isInitializing && (
        <SailingSea bottles={sendStatus === 'thrown' ? sailingBottles : []} />
      )}

      {/* Header */}
      <div className="relative z-10 w-full max-w-md flex items-center justify-between mb-10">
        <h1 className="font-display text-2xl text-sand tracking-tight">
          glassbottles
        </h1>
        <AnimatePresence>
          {hasSent && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              className="font-mono text-xs text-seafoam bg-seafoam/10 px-3 py-1 rounded-full"
            >
              Sent today ✓
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Stage */}
      <div className="relative z-10 w-full max-w-md flex flex-col items-center gap-8 flex-1">

        {/* Status loading — prevents "Your bottle awaits" flash */}
        {isInitializing && (
          <motion.div
            key="initializing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <BottleSkeleton />
          </motion.div>
        )}

        {!isInitializing && (
          <AnimatePresence mode="wait">

            {/* ── IDLE — centered compose box with the bottle tied beneath it,
                bobbing on the sea. Stays mounted through 'throwing' so the drop
                animation plays in place (no remount mid-throw). ── */}
            {(sendStatus === 'idle' || sendStatus === 'throwing') && (
              <motion.div
                key="idle"
                className="relative z-10 w-full flex-1 flex flex-col items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: 'easeInOut' }}
              >
                {/* Heading + compose box — share one centered axis so the text
                    above is perfectly aligned with the box. Fades on throw. */}
                <motion.div
                  className="w-full flex flex-col items-center"
                  animate={{ opacity: sendStatus === 'throwing' ? 0 : 1 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                >
                  {/* Heading */}
                  <div className="text-center">
                    <p className="font-display text-xl text-sand">Your bottle awaits</p>
                    <p className="font-ui text-xs text-sand/55 max-w-[240px] mx-auto leading-relaxed mt-1">
                      Write something for a stranger. They won&apos;t know it&apos;s you.
                    </p>
                    {sendError && (
                      <p
                        className="font-ui text-xs text-coral max-w-[240px] mx-auto leading-relaxed mt-2"
                        role="alert"
                      >
                        Your bottle couldn&apos;t be thrown. Check your connection and try again.
                      </p>
                    )}
                  </div>

                  {/* Compose box — perfectly centered */}
                  <div className="w-[86%] max-w-[320px] mt-6">
                    <MessageEditor onReady={handleThrow} />
                  </div>
                </motion.div>

                {/* Bottle tied beneath the compose box, wobbling on the water */}
                <TetheredBottle
                  dropping={sendStatus === 'throwing'}
                  onDropComplete={handleDropComplete}
                />

                {/* Ambient counter — bottom */}
                <div className="mt-auto pt-6">
                  <OceanCounter />
                </div>
              </motion.div>
            )}

            {/* ── SAILING — already threw today. Bottles float in the fixed
                sea background; this layer is just the foreground copy. ── */}
            {sendStatus === 'thrown' && (
              <motion.div
                key="sailing"
                className="flex flex-col items-center gap-8 text-center w-full flex-1 pt-2"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                {/* Heading over the horizon */}
                <div className="flex flex-col gap-2">
                  {sailingBottles.length === 0 ? (
                    <>
                      <p className="font-display text-2xl text-sand">The sea is calm</p>
                      <p className="font-ui text-sm text-sand/60 max-w-[260px] mx-auto leading-relaxed">
                        Every bottle you&apos;ve thrown has found a stranger. Come back
                        tomorrow to send another.
                      </p>
                    </>
                  ) : atCeiling && !hasSent ? (
                    <>
                      <p className="font-display text-2xl text-sand">Your sea is full</p>
                      <p className="font-ui text-sm text-sand/60 max-w-[260px] mx-auto leading-relaxed">
                        21 bottles still drifting. Throw again once one of them finds a
                        stranger.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-2xl text-sand">Still sailing</p>
                      <p className="font-ui text-sm text-sand/60 max-w-[260px] mx-auto leading-relaxed">
                        {sailingBottles.length} bottle
                        {sailingBottles.length === 1 ? '' : 's'} drifting through the
                        ocean, waiting to be found.
                      </p>
                    </>
                  )}
                </div>

                {/* Timer + counter pinned toward the bottom, over deep water */}
                <div className="mt-auto flex flex-col items-center gap-8 pb-2">
                  <DailyTimer />
                  <OceanCounter />
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        )}
      </div>

      {/* Guest prompt when no user loaded */}
      {!user && sendStatus === 'idle' && (
        <p className="font-ui text-xs text-sand/20 pb-4 text-center">
          Sign in to send your bottle
        </p>
      )}
    </div>
  )
}
