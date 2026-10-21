'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from 'react-redux'
import { useAppDispatch, useAppSelector, type RootState } from '@/store'
import {
  setSendStatus,
  setThrowAnimating,
  setMessage,
  setWeather,
  setVibe,
  selectSendStatus,
  selectDraftStyle,
} from '@/store/bottleSlice'
import { selectUser } from '@/store/authSlice'
import {
  bottleApi,
  useSendBottleMutation,
  useGetTodayBottleStatusQuery,
  useGetAtelierQuery,
  useGetKeeperQuery,
  useGetCoinsQuery,
} from '@/store/api/bottleApi'
import DailyTimer from '@/components/shared/DailyTimer'
import MessageEditor from '@/components/bottle/MessageEditor'
import BottleSkeleton from '@/components/shared/BottleSkeleton'
import OceanCounter from '@/components/shared/OceanCounter'
import SailingSea from '@/components/bottle/SailingSea'
import TetheredBottle from '@/components/bottle/TetheredBottle'
import HeldNotice from '@/components/shared/HeldNotice'
import CareCard from '@/components/shared/CareCard'
import PushNudge from '@/components/shared/PushNudge'
import Whale from '@/components/bottle/Whale'
import { looksLikeCrisis } from '@/lib/care'
import { cn } from '@/lib/utils'
import { buildSeaBottles } from './seaBottles'
import { feel } from '@/lib/feel'
import { CURRENT_INFO, allowedStyle, resolveLook } from '@/lib/dressing'

export default function HomePage() {
  const dispatch = useAppDispatch()
  const sendStatus = useAppSelector(selectSendStatus)
  // The draft is read from the store at throw time, not subscribed to:
  // subscribing re-rendered this whole page — sea included — per keystroke.
  const store = useStore<RootState>()
  const user = useAppSelector(selectUser)

  const [sendBottle] = useSendBottleMutation()
  const [sendError, setSendError] = useState(false)

  // Dressing (042): you throw — and watch drift — the bottle you dressed.
  // Keepers who joined a current also get that current's sea.
  const { data: pieces } = useGetAtelierQuery()
  const { data: keeper, isError: keeperFailed } = useGetKeeperQuery(undefined, {
    skip: process.env.NEXT_PUBLIC_KEEPER !== 'on',
  })
  const isKeeper = !!keeper?.isKeeper
  // Until the membership has loaded, don't strip Keeper pieces: send the
  // dressing as chosen and let send_bottle judge (a keeper_only refusal
  // refetches the membership). Stripping on "not loaded yet" silently threw a
  // Keeper's bottle undressed.
  const keeperKnown =
    process.env.NEXT_PUBLIC_KEEPER !== 'on' || keeper !== undefined || keeperFailed
  const { data: coins } = useGetCoinsQuery(undefined, { skip: !user?.id })
  const draftStyle = useAppSelector(selectDraftStyle)
  const throwStyle = useMemo(
    () => allowedStyle(draftStyle, pieces, isKeeper || !keeperKnown, coins?.unlocked),
    [draftStyle, pieces, isKeeper, keeperKnown, coins?.unlocked],
  )
  const throwLook = useMemo(() => resolveLook(throwStyle, pieces), [throwStyle, pieces])
  const seaTheme = isKeeper && user?.current ? CURRENT_INFO[user.current].sea : undefined
  // Keeper lighthouse (Step 10): brighter with every month kept; dimmed, not
  // removed, after a lapse. Anyone who has never been a Keeper sees none.
  const membership = keeper?.membership
  const lighthouse = membership
    ? {
        lit: isKeeper,
        glow: membership.plan === 'lifetime'
          ? 1
          : Math.min(1, 0.35 + 0.1 * Math.floor((Date.now() - new Date(membership.keeper_since).getTime()) / (30.44 * 864e5))),
      }
    : undefined

  // Crisis care (043): the server's screen decides; a crisis-sounding draft
  // shows help the moment it's thrown, before the screen has read it. Closing
  // it is remembered for the day.
  const [careNow, setCareNow] = useState(false)
  const [careClosedDay, setCareClosedDay] = useState<string | null>(null)
  useEffect(() => {
    try {
      setCareClosedDay(localStorage.getItem('gb:care-closed'))
    } catch {
      /* storage blocked: the card can be closed per visit */
    }
  }, [])

  // Restore send state after page refresh — a user who already sent today
  // should land on the sailing sea, not the "Your bottle awaits" idle screen.
  //
  // Realtime (bottle_delivered → invalidate BottleStatus) is the primary signal
  // that drops a matched bottle out of the sea. The poll is a slow fallback so
  // the sea still reconciles for every user when the socket misses the event
  // (backgrounded tab, dropped connection, prod auth hiccup) — without it a
  // found bottle lingered until a manual reload.
  const {
    data: todayStatus,
    isLoading: isStatusLoading,
    isError: isStatusError,
    isFetching: isStatusFetching,
    refetch: refetchStatus,
  } = useGetTodayBottleStatusQuery(undefined, {
      skip: !user?.id,
      // eslint-disable-next-line no-restricted-syntax -- polls a Supabase RPC (queryFn), not a Vercel /api route
      pollingInterval: 30_000,
      skipPollingIfUnfocused: true,
    })

  // All of the user's undelivered bottles, floating together in the sea.
  const sailingBottles = useMemo(
    () => todayStatus?.sailingBottles ?? [],
    [todayStatus?.sailingBottles]
  )
  const todayKey = todayStatus?.quota.date
  const hasSent = todayStatus?.quota.has_sent ?? false
  // status route fetches at most 21 — length 21 means "at or above the ceiling".
  const atCeiling = sailingBottles.length >= 21

  // True only during a genuine in-session throw hand-off. Set when the bottle
  // lands in the sea; cleared on the next status refetch (which resolves the
  // bottle's fate — now sailing, or already delivered). This gates the optimistic
  // placeholder so it NEVER appears on reload: a bottle that was delivered is
  // legitimately absent from sailingBottles, and without this gate the absence
  // was misread as "throw still settling" → a phantom bottle floated next to the
  // "your bottle found someone" banner.
  const [justThrew, setJustThrew] = useState(false)

  useEffect(() => {
    if (justThrew) setJustThrew(false)
    // Clear on the first refetch after the throw — never re-run on justThrew
    // itself, or it would clear instantly before the bridge is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStatus])

  // While the throw settles, the real "today" bottle may not be in sailingBottles
  // yet (the refetch lags the drop animation). Render an optimistic placeholder at
  // the measured landing spot so the hand-off never blinks; the real bottle takes
  // its place (same spot, same look) once the refetch lands. Gated by justThrew
  // so it only bridges an actual throw, not a reload of an already-delivered one.
  const seaBottles = useMemo(
    () => buildSeaBottles(sailingBottles, sendStatus, todayKey, justThrew, throwStyle),
    [sailingBottles, sendStatus, todayKey, justThrew, throwStyle],
  )

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

  // Re-entrancy guard that works within a single render: `sendStatus` below is
  // a render-captured closure value, so two taps landing before React commits
  // the 'throwing' re-render BOTH see 'idle' and double-fire the RPC (the DB
  // UNIQUE constraint rejects the second, but it still burns a round trip and
  // trips the 23505 path). The ref is live across taps.
  const throwBusyRef = useRef(false)

  async function handleThrow() {
    if (sendStatus !== 'idle' || throwBusyRef.current) return
    throwBusyRef.current = true
    sendFailedRef.current = false
    setSendError(false)
    dispatch(setSendStatus('throwing'))
    dispatch(setThrowAnimating(true))
    try {
      const { message, weather, vibe } = store.getState().bottle
      await sendBottle({ message, style: throwStyle, weather, vibe }).unwrap()
      if (looksLikeCrisis(message)) setCareNow(true)
      // Success — clear the draft so the editor isn't pre-filled with the sent
      // message on the next idle screen (debug report bug 8). The dressing
      // stays; weather and vibe belonged to this bottle.
      dispatch(setMessage(''))
      dispatch(setWeather(null))
      dispatch(setVibe(null))
    } catch (err) {
      sendFailedRef.current = true
      // 23505 = already sent today (second tab / device). Not a failure — the
      // invalidated status refetch flips the screen to sailing; showing the
      // generic "check your connection" copy here was a lie.
      const code = (err as { data?: { code?: string } })?.data?.code
      if (code !== '23505') setSendError(true)
      // 42501 keeper_only: the membership ended since it last loaded. Refetch
      // it so the next try throws the free look instead.
      if (code === '42501') dispatch(bottleApi.util.invalidateTags(['Membership']))
      // If the drop already finished (it set 'thrown'), correct back to idle.
      dispatch(setThrowAnimating(false))
      dispatch(setSendStatus('idle'))
    } finally {
      // Safe to release here: by now sendStatus is 'throwing'/'thrown' (or a
      // committed 'idle' after failure), so the state guard has taken over.
      throwBusyRef.current = false
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
    feel('splash')
    // A real throw just landed — arm the optimistic placeholder for the
    // animation→refetch bridge. Cleared by the next status refetch.
    setJustThrew(true)
  }

  // Show skeleton while we wait for server state so we don't flash
  // "Your bottle awaits" to a user who already sent today.
  //
  // /home is middleware-protected (redirects unauthenticated → /sign-in), so a
  // null user here never means "guest" — it means auth hasn't seeded client-side
  // yet (AuthProvider dispatches setUser a frame or two after first paint). Both
  // the pre-seed frame AND the post-seed status fetch must hold the skeleton, or
  // the idle "Your bottle awaits" compose flashes for a user who already sent —
  // the post-login phantom. authLoading alone doesn't cover this: the guest
  // bootstrap on /sign-in already flipped it false before we reach /home.
  const isInitializing = !user?.id || (isStatusLoading && !todayStatus)
  // A failed first load used to fall through to the idle compose screen —
  // "Your bottle awaits" for someone who may have thrown already. Without
  // server state there is nothing honest to show but a retry.
  const statusFailed = !isInitializing && isStatusError && !todayStatus
  const isThrown = sendStatus === 'thrown'
  const heldBottle = todayStatus?.heldBottle ?? null
  const showCare =
    isThrown &&
    (careNow || todayStatus?.sentBottle?.screen === 'crisis') &&
    careClosedDay !== todayKey
  function closeCare() {
    setCareNow(false)
    setCareClosedDay(todayKey ?? null)
    try {
      if (todayKey) localStorage.setItem('gb:care-closed', todayKey)
    } catch {
      /* storage blocked */
    }
  }

  return (
    <div className="relative flex h-full flex-col items-center overflow-hidden px-5 pt-10 sm:pt-14">
      {/* Full-viewport sea background, present across the whole throw flow so the
          idle pier, the drop, and the sailing sea share one continuous ocean.
          Floating bottles only appear once sailing (idle/throwing pass []).
          Mounted here (not inside the animated stage) so its `fixed` positioning
          stays relative to the viewport rather than a transformed ancestor. */}
      {!isInitializing && !statusFailed && (
        <SailingSea bottles={seaBottles} theme={seaTheme} lighthouse={lighthouse} />
      )}
      {!isInitializing && !statusFailed && <Whale whale={todayStatus?.whale} />}

      {/* The throwable bottle — pinned to the screen top-right, wiggling with a
          shimmer. Shown only while a throw is available; on throw it vanishes and
          re-appears at a random spot on the sea. */}
      {!isInitializing && !statusFailed && (sendStatus === 'idle' || sendStatus === 'throwing') && (
        <TetheredBottle
          dropping={sendStatus === 'throwing'}
          landingDayKey={todayKey}
          onDropComplete={handleDropComplete}
          look={throwLook}
        />
      )}

      {/* Header */}
      <div className="relative z-10 mb-4 flex w-full items-center justify-between sm:mb-8">
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl text-sand tracking-tight">
            glassbottles
          </h1>
          {/* Tides: a quiet run-of-days count, left by the wordmark — the right
              corner belongs to the throwable bottle. No warnings, no loss
              copy: a missed day just starts a new tide. */}
          {(todayStatus?.tides ?? 0) >= 2 && (
            <span
              className="font-mono text-[11px] text-sand/55 bg-white/5 px-2.5 py-0.5 rounded-full"
              title="Days in a row you've thrown a bottle"
            >
              {todayStatus!.tides} tides
            </span>
          )}
          {/* Earn-only coins (049) — spent in the Atelier. */}
          {(coins?.balance ?? 0) > 0 && (
            <span
              className="font-mono text-[11px] text-sand/55 bg-white/5 px-2.5 py-0.5 rounded-full"
              title="Coins you've earned — spend them on pieces in Dress"
            >
              {coins!.balance} ✦
            </span>
          )}
        </div>
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
      <div className="relative z-10 flex min-h-0 w-full max-w-md flex-1 flex-col items-center">

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

        {statusFailed && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" role="alert">
            <p className="font-display text-xl text-sand">The tide is out</p>
            <p className="font-ui text-xs text-sand/55 max-w-[240px] leading-relaxed">
              We couldn&apos;t reach the ocean just now. Check your connection.
            </p>
            <button
              type="button"
              onClick={() => void refetchStatus()}
              disabled={isStatusFetching}
              className="px-6 py-2.5 rounded-2xl bg-seafoam/10 text-seafoam font-ui text-sm font-medium hover:bg-seafoam/20 transition-colors disabled:opacity-50"
            >
              {isStatusFetching ? 'Trying…' : 'Try again'}
            </button>
          </div>
        )}

        {!isInitializing && !statusFailed && (
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
                  className={cn(
                    'relative z-10 flex min-h-0 w-full flex-1 flex-col items-center justify-center',
                    // The lift clears the footer; a held notice needs the room instead.
                    !heldBottle && '-translate-y-8 sm:-translate-y-10',
                  )}
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
                    {/* A held bottle's notice takes the heading's place — on a
                        phone both don't fit above the compose box. */}
                    {heldBottle ? (
                      <div className="flex w-[94%] justify-center">
                        <HeldNotice held={heldBottle} canRethrow />
                      </div>
                    ) : (
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
                    )}
                  </motion.div>

                  {/* Compose box with the bottle inside its top-right corner.
                      On throw the box fades out and the bottle vanishes; the
                      thrown bottle re-appears at a random spot on the sea. */}
                  <div className="relative mt-5 w-[94%] max-w-[420px] sm:mt-6">
                    <motion.div
                      animate={{ opacity: sendStatus === 'throwing' ? 0 : 1 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                    >
                      <MessageEditor onReady={handleThrow} />
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── STATUS + FOOTER — always present, sitting low over the deep
                water. The sailing copy shows alongside the compose box (the
                user's older bottles are always drifting in the sea behind it),
                and remains once the sea is the only thing on screen. ── */}
            <div
              className={cn(
                'z-10 flex w-full flex-col items-center text-center',
                isThrown
                  ? 'absolute left-1/2 top-[10%] -translate-x-1/2 gap-3 px-4'
                  : 'relative mt-auto gap-4 pb-8 pt-4 sm:gap-6 sm:pt-6 sm:pb-10'
              )}
            >
              {/* A second hold today: the day isn't restored again. */}
              {isThrown && heldBottle && <HeldNotice held={heldBottle} canRethrow={false} />}
              {showCare && <CareCard timezone={user?.timezone} onClose={closeCare} />}
              {/* Right after a throw, once: "want to know when it's found?" */}
              {isThrown && hasSent && !showCare && !heldBottle && <PushNudge />}

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
    </div>
  )
}
