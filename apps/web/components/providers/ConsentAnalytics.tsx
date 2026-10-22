'use client'

import { useEffect, useState } from 'react'
import { GoogleAnalytics } from '@next/third-parties/google'
import { motion } from 'motion/react'
import { spring } from '@/components/ui/springs'

const KEY = 'gb-analytics-consent'
const OPEN_EVENT = 'gb-open-cookie-settings'

type Choice = 'granted' | 'denied' | null

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

// Loads GA only after explicit opt-in. Banner shows until the user chooses,
// and can be re-opened via <CookieSettingsButton />.
export default function ConsentAnalytics({ gaId }: { gaId: string | undefined }) {
  const [choice, setChoice] = useState<Choice>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const saved = read()
    setChoice(saved)
    setOpen(saved === null)
    const reopen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, reopen)
    return () => window.removeEventListener(OPEN_EVENT, reopen)
  }, [])

  function decide(next: 'granted' | 'denied') {
    try {
      localStorage.setItem(KEY, next)
    } catch {}
    if (next === 'denied' && choice === 'granted') {
      // GA script is already running this page: drop its cookies and reload without it.
      document.cookie.split(';').forEach((c) => {
        const name = c.split('=')[0].trim()
        if (name.startsWith('_ga')) {
          document.cookie = `${name}=; Max-Age=0; path=/`
          document.cookie = `${name}=; Max-Age=0; path=/; domain=.${location.hostname}`
        }
      })
      location.reload()
      return
    }
    setChoice(next)
    setOpen(false)
  }

  // No GA id (dev/preview) → nothing to consent to.
  if (!gaId) return null

  return (
    <>
      {choice === 'granted' && <GoogleAnalytics gaId={gaId} />}
      {open && (
        <div
          role="dialog"
          aria-label="Analytics cookies"
          className="fixed inset-x-0 bottom-0 z-[100] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="glass-strong mx-auto flex max-w-xl flex-col gap-3 rounded-3xl p-4 font-ui text-sm text-sand/85 sm:flex-row sm:items-center"
          >
            <p className="flex-1">
              We use Google Analytics cookies to see how the site is used. Your messages are never
              shared. See our{' '}
              <a href="/privacy" className="text-seafoam hover:underline">
                privacy policy
              </a>
              .
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => decide('denied')}
                className="press glass-fill flex-1 rounded-full px-4 py-2.5 text-sand hover:bg-white/[0.11] transition-[background-color,transform] sm:flex-none"
              >
                Decline
              </button>
              <button
                onClick={() => decide('granted')}
                className="press glass-fill flex-1 rounded-full px-4 py-2.5 text-sand hover:bg-white/[0.11] transition-[background-color,transform] sm:flex-none"
              >
                Accept
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}

export function CookieSettingsButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="text-seafoam hover:underline"
    >
      cookie settings
    </button>
  )
}
