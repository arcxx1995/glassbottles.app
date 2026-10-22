import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const INPUT_CLASS =
  'field w-full rounded-2xl px-4 py-3 font-ui text-sm text-sand placeholder:text-sand/40 ' +
  'outline-none transition-[border-color,box-shadow] duration-200 focus:border-seafoam/50 ' +
  'focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35),0_0_0_3px_rgba(78,205,196,0.18)]'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(INPUT_CLASS, className)} {...props} />
  },
)
