'use client'

import { forwardRef } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { springPress } from './springs'

const button = cva(
  'inline-flex items-center justify-center gap-2 font-ui font-semibold tracking-wide ' +
    'select-none outline-none transition-[filter,box-shadow,background-color] duration-200 ' +
    'focus-visible:ring-2 focus-visible:ring-seafoam/60 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-seafoam text-ocean-deep shadow-seafoam hover:brightness-110',
        // Secondary buttons usually sit on a card: a fill, not a second blur.
        glass: 'glass-fill text-sand hover:bg-white/[0.11]',
        tint: 'glass-tint text-sand hover:brightness-110',
        coral: 'bg-coral text-ocean-deep shadow-coral hover:brightness-110',
        ghost: 'text-sand/70 hover:text-sand hover:bg-white/5',
      },
      size: {
        sm: 'h-9 px-4 text-xs rounded-full',
        md: 'h-11 px-5 text-sm rounded-full',
        lg: 'h-12 px-6 text-sm rounded-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export type ButtonProps = Omit<HTMLMotionProps<'button'>, 'ref'> & VariantProps<typeof button>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={springPress}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  )
})
