'use client'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/sign-in')
  }

  return (
    <div className="flex flex-col min-h-screen pt-14 px-5">
      <div className="mb-8">
        <h1 className="font-display text-2xl text-sand">Settings</h1>
      </div>
      <div className="flex flex-col gap-4 max-w-md w-full">
        <motion.button
          onClick={() => void handleSignOut()}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex items-center gap-3 bg-ocean-mid rounded-3xl border border-white/5 p-5 text-left hover:border-coral/20 transition-colors group w-full"
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
