'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { LogOut, Shield, Info } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAppSelector } from '@/store'
import { selectUser } from '@/store/authSlice'

// ─── Animation helpers ────────────────────────────────────────────────────────
const EASE_OUT = [0.25, 0.46, 0.45, 0.94] as const

function staggerItem(i: number) {
  return {
    initial: { opacity: 0, y: 10 } as const,
    animate: { opacity: 1, y: 0 } as const,
    transition: { duration: 0.35, ease: EASE_OUT, delay: i * 0.06 },
  }
}

// ─── Row component ────────────────────────────────────────────────────────────

interface RowProps {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  meta?: string
  onClick?: () => void
  destructive?: boolean
}

function SettingsRow({
  icon,
  iconBg,
  iconColor,
  label,
  meta,
  onClick,
  destructive = false,
}: RowProps) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      className={`
        flex items-center gap-4 bg-ocean-mid rounded-3xl border border-white/5 p-5
        transition-colors duration-200 group w-full text-left
        ${onClick
          ? destructive
            ? 'cursor-pointer hover:border-coral/20'
            : 'cursor-pointer hover:border-seafoam/20'
          : ''
        }
      `}
    >
      {/* Icon tile */}
      <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        <span className={iconColor}>{icon}</span>
      </div>

      {/* Text */}
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className={`
            font-ui text-sm font-medium transition-colors duration-200
            ${destructive
              ? 'text-coral/70 group-hover:text-coral'
              : 'text-sand/60 group-hover:text-sand/90'
            }
          `}
        >
          {label}
        </span>
        {meta && (
          <span className="font-ui text-xs text-sand/30 mt-0.5 leading-snug">
            {meta}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-ui text-[10px] text-sand/30 uppercase tracking-widest px-1 mb-2 mt-2">
      {children}
    </p>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const user = useAppSelector(selectUser)

  // Email comes from Supabase Auth session, not the profiles table
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [supabase])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/sign-in')
  }

  return (
    <div className="flex flex-col min-h-screen pt-14 px-5">
      {/* Header */}
      <motion.div className="mb-8" {...staggerItem(0)}>
        <h1 className="font-display text-2xl text-sand">Settings</h1>
        {email && (
          <p className="font-mono text-xs text-sand/30 mt-1 truncate max-w-[240px]">
            {email}
          </p>
        )}
        {/* Member since — profile has created_at */}
        {user?.created_at && (
          <p className="font-mono text-[10px] text-sand/20 mt-0.5">
            member since{' '}
            {new Date(user.created_at).toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}
          </p>
        )}
      </motion.div>

      <div className="flex flex-col max-w-md w-full pb-8">

        {/* ── Account section ───────────────────────────────────────── */}
        <motion.div {...staggerItem(1)}>
          <SectionLabel>Privacy</SectionLabel>
        </motion.div>

        <motion.div className="flex flex-col gap-3" {...staggerItem(2)}>
          <SettingsRow
            icon={<Shield size={17} strokeWidth={1.5} />}
            iconBg="bg-seafoam/10"
            iconColor="text-seafoam"
            label="Anonymous by design"
            meta="Your identity is never shared with message receivers"
          />
        </motion.div>

        {/* ── About section ─────────────────────────────────────────── */}
        <motion.div className="mt-6" {...staggerItem(3)}>
          <SectionLabel>About</SectionLabel>
        </motion.div>

        <motion.div className="flex flex-col gap-3" {...staggerItem(4)}>
          <SettingsRow
            icon={<Info size={17} strokeWidth={1.5} />}
            iconBg="bg-sand/[0.06]"
            iconColor="text-sand/50"
            label="How it works"
            meta="One bottle per day, matched to a random stranger"
          />
        </motion.div>

        {/* ── Session section ───────────────────────────────────────── */}
        <motion.div className="mt-6" {...staggerItem(5)}>
          <SectionLabel>Session</SectionLabel>
        </motion.div>

        <motion.div {...staggerItem(6)}>
          <SettingsRow
            icon={<LogOut size={17} strokeWidth={1.5} />}
            iconBg="bg-coral/10"
            iconColor="text-coral"
            label="Sign out"
            onClick={() => void handleSignOut()}
            destructive
          />
        </motion.div>

        {/* ── Build footer ──────────────────────────────────────────── */}
        <motion.p
          className="font-mono text-[10px] text-sand/15 text-center mt-10"
          {...staggerItem(7)}
        >
          glassbottles · one bottle, one stranger
        </motion.p>
      </div>
    </div>
  )
}
