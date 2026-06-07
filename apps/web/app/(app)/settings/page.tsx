'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, LogOut, Check, ShieldCheck, X, Pencil } from 'lucide-react'
import { useAppSelector, useAppDispatch } from '@/store'
import { selectUser } from '@/store/authSlice'
import { useGetProfileQuery, useUpdateProfileMutation, authApi } from '@/store/api/authApi'
import {
  useRegisterWhatsAppMutation,
  useRemoveWhatsAppMutation,
} from '@/store/api/notificationApi'
import { createClient } from '@/lib/supabase/client'

// Shows last 4 digits of a phone number, masks the rest.
// "+919876543210" → "+91 ••••3210"
function maskPhone(number: string): string {
  if (number.length < 5) return number
  const last4 = number.slice(-4)
  const prefix = number.startsWith('+') ? number.slice(0, 3) : ''
  return `${prefix} ••••${last4}`
}

export default function SettingsPage() {
  const router = useRouter()
  const dispatch = useAppDispatch()
  const user = useAppSelector(selectUser)
  const supabase = createClient()

  const { data: profile } = useGetProfileQuery(undefined, { skip: !user?.id })
  const [updateProfile] = useUpdateProfileMutation()
  const [registerWhatsApp, { isLoading: isRegistering }] =
    useRegisterWhatsAppMutation()
  const [removeWhatsApp, { isLoading: isRemoving }] = useRemoveWhatsAppMutation()

  // Edit mode is off when a number is already saved
  const [isEditing, setIsEditing] = useState(false)
  const [input, setInput] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Open edit mode when there's no saved number yet
  useEffect(() => {
    if (profile && !profile.whatsapp_number) {
      setIsEditing(true)
    }
  }, [profile?.whatsapp_number])

  function handleStartEdit() {
    setInput('')
    setSaveState('idle')
    setErrorMsg('')
    setIsEditing(true)
  }

  function handleCancelEdit() {
    setIsEditing(false)
    setInput('')
    setSaveState('idle')
    setErrorMsg('')
  }

  async function handleSaveWhatsApp() {
    setSaveState('idle')
    setErrorMsg('')
    const trimmed = input.trim()
    if (!trimmed) return

    try {
      await registerWhatsApp({ whatsapp_number: trimmed }).unwrap()
      // Cross-slice: invalidate Profile so settings + any cached getProfile refresh
      dispatch(authApi.util.invalidateTags(['Profile']))
      setSaveState('saved')
      setIsEditing(false)
      setTimeout(() => setSaveState('idle'), 2500)
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'data' in err
          ? (err as { data?: { error?: string } }).data?.error
          : undefined
      setErrorMsg(message ?? 'Failed to save. Check format: +919XXXXXXXXX')
      setSaveState('error')
    }
  }

  async function handleRemoveWhatsApp() {
    setErrorMsg('')
    try {
      await removeWhatsApp().unwrap()
      dispatch(authApi.util.invalidateTags(['Profile']))
      // Also update via updateProfile to ensure cache consistency
      await updateProfile({ whatsapp_number: null }).unwrap()
    } catch {
      setErrorMsg('Failed to remove. Try again.')
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/sign-in')
  }

  const hasNumber = !!profile?.whatsapp_number

  return (
    <div className="flex flex-col min-h-screen pt-14 px-5">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl text-sand">Settings</h1>
      </div>

      <div className="flex flex-col gap-4 max-w-md w-full">

        {/* WhatsApp notifications card */}
        <motion.div
          className="bg-ocean-mid rounded-3xl border border-white/5 p-5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-seafoam/10 flex items-center justify-center shrink-0">
              <Phone size={17} className="text-seafoam" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-ui text-sm font-medium text-sand">
                WhatsApp Notifications
              </p>
              <p className="font-ui text-xs text-sand/40">
                Get notified when a bottle arrives
              </p>
            </div>
          </div>

          {/* Viewing mode — number already saved */}
          <AnimatePresence mode="wait">
            {!isEditing && hasNumber && (
              <motion.div
                key="view"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex-1 font-mono text-sm text-sand/80 bg-glass
                                   border border-white/8 rounded-xl px-4 py-2.5 tracking-wider">
                    {maskPhone(profile!.whatsapp_number!)}
                  </span>
                  <button
                    onClick={handleStartEdit}
                    className="p-2.5 rounded-xl bg-glass border border-white/8
                               text-sand/50 hover:text-seafoam hover:border-seafoam/25
                               transition-colors"
                    aria-label="Change WhatsApp number"
                    title="Change"
                  >
                    <Pencil size={14} strokeWidth={1.75} />
                  </button>
                  <button
                    onClick={handleRemoveWhatsApp}
                    disabled={isRemoving}
                    className="p-2.5 rounded-xl bg-glass border border-white/8
                               text-sand/50 hover:text-coral hover:border-coral/25
                               transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    aria-label="Remove WhatsApp number"
                    title="Remove"
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </div>

                {saveState === 'saved' && (
                  <p className="font-ui text-xs text-seafoam flex items-center gap-1.5">
                    <Check size={12} strokeWidth={2.5} />
                    Saved
                  </p>
                )}
                {profile?.whatsapp_verified && (
                  <p className="font-ui text-xs text-seafoam flex items-center gap-1.5">
                    <ShieldCheck size={13} strokeWidth={2} />
                    Verified
                  </p>
                )}
              </motion.div>
            )}

            {/* Editing mode */}
            {isEditing && (
              <motion.div
                key="edit"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex gap-2 mb-2">
                  <input
                    type="tel"
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value)
                      setSaveState('idle')
                      setErrorMsg('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSaveWhatsApp()
                    }}
                    placeholder="+91 9XXXXXXXXX"
                    className="flex-1 bg-glass border border-white/10 rounded-xl px-4 py-3
                               font-mono text-sm text-sand placeholder:text-sand/25
                               outline-none focus:border-seafoam/40 transition-colors"
                    autoFocus
                  />
                  <button
                    onClick={() => void handleSaveWhatsApp()}
                    disabled={isRegistering || !input.trim()}
                    className="px-4 py-3 rounded-xl bg-seafoam/10 text-seafoam font-ui text-sm
                               font-medium hover:bg-seafoam/20 transition-colors
                               disabled:opacity-40 disabled:pointer-events-none
                               flex items-center gap-1.5 shrink-0"
                  >
                    {isRegistering ? (
                      <span className="w-4 h-4 border-2 border-seafoam/40 border-t-seafoam
                                       rounded-full animate-spin" />
                    ) : saveState === 'saved' ? (
                      <><Check size={14} strokeWidth={2.5} /> Saved</>
                    ) : (
                      'Save'
                    )}
                  </button>
                  {hasNumber && (
                    <button
                      onClick={handleCancelEdit}
                      className="p-3 rounded-xl bg-glass border border-white/8
                                 text-sand/40 hover:text-sand/70 transition-colors"
                      aria-label="Cancel editing"
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  )}
                </div>

                {saveState === 'error' && errorMsg && (
                  <p className="font-ui text-xs text-coral mt-1">{errorMsg}</p>
                )}

                <p className="font-ui text-[11px] text-sand/25 mt-2 leading-relaxed">
                  Enter in E.164 format. Example: <span className="font-mono">+919876543210</span>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Sign out */}
        <motion.button
          onClick={() => void handleSignOut()}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.07 }}
          className="flex items-center gap-3 bg-ocean-mid rounded-3xl border border-white/5
                     p-5 text-left hover:border-coral/20 transition-colors group w-full"
        >
          <div className="w-9 h-9 rounded-xl bg-coral/10 flex items-center justify-center shrink-0">
            <LogOut size={17} className="text-coral" strokeWidth={1.5} />
          </div>
          <span className="font-ui text-sm font-medium text-sand/50 group-hover:text-sand/80 transition-colors">
            Sign out
          </span>
        </motion.button>

      </div>
    </div>
  )
}
