'use client'

import { useEffect, useState } from 'react'
import CrisisSupport from '@/components/bottle/CrisisSupport'
import { INPUT_CLASS } from '@/components/ui/Input'
import { HELD_COPY, checkMessage, type CheckResult } from '@/lib/messageCheck'
import { cn } from '@/lib/utils'

const CHECK_DEBOUNCE_MS = 800

/** The live filter on a draft. `gate` is the final check before sending, so a
 *  quick tap can't beat the debounce. Only 'ok' sends, as with bottles. */
export function useLiveCheck(text: string) {
  const draft = text.trim()
  const [check, setCheck] = useState<CheckResult | null>(null)

  useEffect(() => {
    if (!draft) {
      setCheck(null)
      return
    }
    let stale = false
    const t = setTimeout(async () => {
      const result = await checkMessage(draft)
      if (!stale) setCheck(result)
    }, CHECK_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [draft])

  return {
    check: draft ? check : null,
    blocked: !!draft && (check?.verdict === 'held' || check?.verdict === 'crisis'),
    gate: async () => {
      const result = await checkMessage(draft)
      setCheck(result)
      return result.verdict === 'ok'
    },
  }
}

const KAYAK_COPY: Record<string, string> = {
  ...HELD_COPY,
  contact: 'Kayaks stay anonymous: no contact details, handles or links.',
}

export const heldCopy = (reason: string | null | undefined) => KAYAK_COPY[reason ?? ''] ?? KAYAK_COPY.review

/** A textarea with the live filter's answer under it. */
export default function CheckedText({
  value,
  onChange,
  check,
  label,
  placeholder,
  max,
  crisisLead,
}: {
  value: string
  onChange: (v: string) => void
  check: CheckResult | null
  label: string
  placeholder: string
  max: number
  crisisLead: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="font-ui text-xs text-sand/60">{label}</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, max))}
          rows={3}
          className={cn(INPUT_CLASS, 'resize-none')}
          placeholder={placeholder}
        />
      </label>
      <span className="self-end font-mono text-[10px] text-sand/35">
        {value.length}/{max}
      </span>
      {check?.verdict === 'held' && (
        <p role="alert" className="font-ui text-xs leading-relaxed text-coral">
          This can&rsquo;t be sent. {heldCopy(check.reason)}{' '}
          <a href="/guidelines" target="_blank" className="underline">
            Community guidelines
          </a>
          .
        </p>
      )}
      {check?.verdict === 'unknown' && (
        <p role="alert" className="font-ui text-xs leading-relaxed text-sand/60">
          {check.reason === 'rate_limited'
            ? 'That’s a lot of checks in a short time. Wait a few minutes, then try again.'
            : 'We couldn’t check this just now. Give it a moment and try again.'}
        </p>
      )}
      {check?.verdict === 'crisis' && <CrisisSupport lead={crisisLead} />}
    </div>
  )
}
