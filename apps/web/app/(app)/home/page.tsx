'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  setSendStatus,
  setThrowAnimating,
  resetBottleState,
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

const BottleCanvas = dynamic(
  () => import('@/components/bottle/BottleCanvas'),
  { ssr: false }
)
const ThrowAnimation = dynamic(
  () => import('@/components/bottle/ThrowAnimation'),
  { ssr: false }
)

export default function HomePage() {
  const dispatch = useAppDispatch()
  const sendStatus = useAppSelector(selectSendStatus)
  const message = useAppSelector(selectMessage)
  const user = useAppSelector(selectUser)

  const [sendBottle] = useSendBottleMutation()

  // Restore send state after page refresh — without this, a user who already
  // sent today sees "Your bottle awaits" until they try to throw again.
  const { data: todayStatus, isLoading: isStatusLoading } =
    useGetTodayBottleStatusQuery(undefined, { skip: !user?.id })

  useEffect(() => {
    if (todayStatus?.quota.has_sent && sendStatus === 'idle') {
      dispatch(setSendStatus('thrown'))
    }
  }, [todayStatus, sendStatus, dispatch])

  async function handleThrow() {
    dispatch(setSendStatus('throwing'))
    dispatch(setThrowAnimating(true))
    try {
      await sendBottle({ message }).unwrap()
    } catch {
      // Animation completes regardless — Felix's route handles the actual error
    }
  }

  function handleAnimationComplete() {
    dispatch(setThrowAnimating(false))
    dispatch(setSendStatus('thrown'))
  }

  // Show skeleton while we wait for server state so we don't flash
  // "Your bottle awaits" to a user who already sent today
  const isInitializing = !!user?.id && isStatusLoading && !todayStatus

  return (
    <div className="flex flex-col items-center min-h-screen pt-14 px-5">
      {/* Header */}
      <div className="w-full max-w-md flex items-center justify-between mb-10">
        <h1 className="font-display text-2xl text-sand tracking-tight">
          glassbottles
        </h1>
        <AnimatePresence>
          {sendStatus === 'thrown' && (
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
      <div className="w-full max-w-md flex flex-col items-center gap-8 flex-1">

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

            {/* ── IDLE ─────────────────────────────────────── */}
            {sendStatus === 'idle' && (
              <motion.div
                key="idle"
                className="flex flex-col items-center gap-8 w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <BottleCanvas />
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="font-display text-xl text-sand">Your bottle awaits</p>
                  <p className="font-ui text-sm text-sand/50 max-w-[260px] leading-relaxed">
                    Write something for a stranger. They won&apos;t know it&apos;s you.
                  </p>
                  <button
                    onClick={() => dispatch(setSendStatus('composing'))}
                    className="mt-3 px-10 py-4 rounded-2xl bg-coral text-ocean-deep font-ui
                               font-semibold text-base tracking-wide transition-all duration-150
                               active:scale-[0.97] hover:brightness-110"
                  >
                    Write a message
                  </button>
                </div>
                <OceanCounter />
              </motion.div>
            )}

            {/* ── COMPOSING ────────────────────────────────── */}
            {sendStatus === 'composing' && (
              <motion.div
                key="composing"
                className="flex flex-col items-center gap-6 w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <BottleCanvas />
                <MessageEditor className="w-full" onReady={handleThrow} />
                <button
                  onClick={() => dispatch(resetBottleState())}
                  className="font-ui text-xs text-sand/30 hover:text-sand/60 transition-colors"
                >
                  Cancel
                </button>
              </motion.div>
            )}

            {/* ── THROWING ─────────────────────────────────── */}
            {sendStatus === 'throwing' && (
              <motion.div
                key="throwing"
                className="flex flex-col items-center w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ThrowAnimation onComplete={handleAnimationComplete} />
              </motion.div>
            )}

            {/* ── THROWN ───────────────────────────────────── */}
            {sendStatus === 'thrown' && (
              <motion.div
                key="thrown"
                className="flex flex-col items-center gap-10 text-center w-full pt-4"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <motion.div
                  className="w-24 h-24 rounded-full bg-seafoam/8 flex items-center justify-center"
                  animate={{ scale: [1, 1.04, 1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <span className="text-5xl select-none" role="img" aria-label="bottle">
                    🫙
                  </span>
                </motion.div>

                <div className="flex flex-col gap-2">
                  <p className="font-display text-2xl text-sand">Bottle sent</p>
                  <p className="font-ui text-sm text-sand/50 max-w-[220px] mx-auto leading-relaxed">
                    Somewhere out there, a stranger will find it.
                  </p>
                </div>

                <DailyTimer />
                <OceanCounter />
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
