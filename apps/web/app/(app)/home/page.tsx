'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  const todayKey = todayStatus?.quota.date
  const hasSent = todayStatus?.quota.has_sent ?? false
  // status route fetches at most 21 — length 21 means "at or above the ceiling".
  const atCeiling = sailingBottles.length >= 21

  // While the throw settles, the real "today" bottle may not be in sailingBottles
  // yet (the refetch lags the drop animation). Render an optimistic placeholder at
  // the measured landing spot so the hand-off never blinks; the real bottle takes
  // its place (same spot, same look) once the refetch lands.
  const seaBottles = useMemo(() => {
    if (
      sendStatus === 'thrown' &&
      todayKey &&
      !sailingBottles.some((b) => b.day_key === todayKey)
    ) {
      return [...sailingBottles, { id: '__pending_today__', day_key: todayKey }]
    }
    return sailingBottles
  }, [sailingBottles, sendStatus, todayKey])

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
        <SailingSea bottles={seaBottles} />
      )}

      {/* Header */}
      <div className="relative z-10 w-full flex items-center justify-between mb-10">
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
      <div className="relative z-10 w-full max-w-md flex flex-col items-center flex-1">

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
          <>
            {/* ── COMPOSE LAYER — the bottle tied beneath the compose box,
                bobbing on the sea. Mounts only when a throw is available
                (quota unused, sea below the ceiling). Stays mounted through
                'throwing' so the tether-release drop plays in place, then
                unmounts as the scene settles into sailing. ── */}
            <AnimatePresence mode="wait">
              {(sendStatus === 'idle' || sendStatus === 'throwing') && (
                <motion.div
                  key="compose"
                  className="relative z-10 w-full flex-1 flex flex-col items-center justify-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  // No exit fade: the landed throw bottle must NOT fade out. The
                  // compose layer unmounts INSTANTLY, revealing the identical
                  // drift bottle sitting on the exact same pixel beneath it.
                  exit={{ opacity: 1, transition: { duration: 0 } }}
                  transition={{ duration: 0.45, ease: 'easeInOut' }}
                >
                  {/* Heading — fades out the instant the throw begins. */}
                  <motion.div
                    className="w-full flex flex-col items-center"
                    animate={{ opacity: sendStatus === 'throwing' ? 0 : 1 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                  >
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
                  </motion.div>

                  {/* Compose box with the bottle inside its top-right corner.
                      On throw the box fades out and the bottle vanishes; the
                      thrown bottle re-appears at a random spot on the sea. */}
                  <div className="relative w-[94%] max-w-[420px] mt-6">
                    <motion.div
                      animate={{ opacity: sendStatus === 'throwing' ? 0 : 1 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                    >
                      <MessageEditor
                        onReady={handleThrow}
                        dropping={sendStatus === 'throwing'}
                        onDropComplete={handleDropComplete}
                      />
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── STATUS + FOOTER — always present, sitting low over the deep
                water. The sailing copy shows alongside the compose box (the
                user's older bottles are always drifting in the sea behind it),
                and remains once the sea is the only thing on screen. ── */}
            <div className="relative z-10 mt-auto flex flex-col items-center gap-6 pb-2 text-center w-full pt-6">
              {sailingBottles.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {atCeiling && !hasSent ? (
                    <>
                      <p className="font-display text-xl text-sand">Your sea is full</p>
                      <p className="font-ui text-xs text-sand/55 max-w-[260px] mx-auto leading-relaxed">
                        21 bottles still drifting. Throw again once one of them finds a
                        stranger.
                      </p>
                    </>
                  ) : (
                    <p className="font-ui text-sm text-sand/60 max-w-[260px] mx-auto leading-relaxed">
                      {sailingBottles.length} bottle
                      {sailingBottles.length === 1 ? '' : 's'} drifting through the
                      ocean, waiting to be found.
                    </p>
                  )}
                </div>
              )}

              {/* The sea is calm — only once everything has been found AND there's
                  nothing left to throw today. */}
              {sailingBottles.length === 0 && hasSent && (
                <div className="flex flex-col gap-1.5">
                  <p className="font-display text-xl text-sand">The sea is calm</p>
                  <p className="font-ui text-xs text-sand/55 max-w-[260px] mx-auto leading-relaxed">
                    Every bottle you&apos;ve thrown has found a stranger. Come back
                    tomorrow to send another.
                  </p>
                </div>
              )}

              {hasSent && <DailyTimer />}
              <OceanCounter />
            </div>
          </>
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
