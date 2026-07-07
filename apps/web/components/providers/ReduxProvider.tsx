'use client'

import { Provider } from 'react-redux'
import { MotionConfig } from 'motion/react'
import { store } from '@/store'

export function ReduxProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      {/* reducedMotion="user" makes EVERY motion component honor
          prefers-reduced-motion (transforms snap, opacity still fades) —
          components no longer need individual useReducedMotion guards for
          entrances. Infinite decorative loops still check useReducedMotion
          themselves to stop entirely. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </Provider>
  )
}
