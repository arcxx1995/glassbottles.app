'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { spring } from '@/components/ui/springs'
import { BellRing, Share } from 'lucide-react'
import { enablePush, getPushState, type PushState } from '@/lib/push'

// After a throw — the moment someone most wants to know — offer, once, to be
// told when the bottle is found (migration 044). On an iPhone tab it asks for
// the Home Screen install instead, since iOS only lets installed apps push.

const KEY = 'gb:push-nudge'

export default function PushNudge() {
  const [state, setState] = useState<PushState | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(KEY) === 'done')
    } catch {
      setDismissed(false)
    }
    void getPushState().then(setState)
  }, [])

  function done() {
    setDismissed(true)
    try {
      localStorage.setItem(KEY, 'done')
    } catch {
      /* storage blocked: it may ask again next visit */
    }
  }

  if (dismissed || (state !== 'off' && state !== 'install')) return null

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className="w-full max-w-[380px] rounded-3xl glass-strong px-4 py-3 text-left"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-seafoam">
          {state === 'install' ? <Share size={16} strokeWidth={1.5} /> : <BellRing size={16} strokeWidth={1.5} />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-ui text-sm text-sand/85">Want to know when it&rsquo;s found?</p>
          <p className="font-ui text-[11px] text-sand/45 leading-snug mt-0.5">
            {state === 'install'
              ? 'Tap Share, then “Add to Home Screen”. Open glassbottles from there to turn on notifications.'
              : 'A quiet notification when a stranger finds your bottle, or one finds you.'}
          </p>
          <div className="flex items-center gap-1 mt-2 -ml-1">
            {state === 'off' && (
              <button
                type="button"
                onClick={() => void enablePush().then((s) => (s === 'off' ? setState(s) : done()))}
                className="press px-3 py-1.5 rounded-full bg-seafoam/15 text-seafoam font-ui text-xs font-medium hover:bg-seafoam/25 transition-[color,background-color,transform]"
              >
                Notify me
              </button>
            )}
            <button
              type="button"
              onClick={done}
              className="press px-3 py-1.5 rounded-xl font-ui text-xs text-sand/50 hover:text-sand/80 transition-[color,background-color,transform]"
            >
              {state === 'install' ? 'Got it' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
