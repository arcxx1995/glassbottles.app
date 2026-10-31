'use client'

import { forwardRef, useEffect, type ComponentProps, type MouseEvent, type Ref } from 'react'
import type { Route } from 'next'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { flushSync } from 'react-dom'

// Route changes as a View Transition: the old page cross-fades out, the new
// one lifts in, and elements sharing a `view-transition-name` (nav pill,
// bottle) morph between pages. CSS lives in globals.css. Browsers without the
// API, and reduced motion, get Next's normal instant swap.

type StartVT = (cb: () => Promise<void>) => { finished: Promise<void> }

let settle: (() => void) | null = null

function canTransition() {
  return (
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** router.push wrapped in a view transition. `onCaptured` runs once the old
 *  page is snapshotted, before the new one renders: the place to drop a
 *  shared element's name from a source that will still be in the DOM. */
export function transitionTo(router: ReturnType<typeof useRouter>, href: Route, onCaptured?: () => void) {
  if (!canTransition() || href === location.pathname) {
    onCaptured?.()
    return router.push(href)
  }
  const start = (document as unknown as { startViewTransition: StartVT }).startViewTransition.bind(document)
  start(
    () =>
      new Promise<void>((resolve) => {
        onCaptured?.()
        settle = resolve
        router.push(href)
        // ponytail: safety net if the route never commits (error, same page).
        setTimeout(resolve, 600)
      }),
  )
}

/** A same-page state change as a view transition (a bottle lifting off the
 *  shelf). Without the API, or with reduced motion, it just happens. */
export function viewTransition(update: () => void): Promise<void> {
  if (!canTransition()) {
    update()
    return Promise.resolve()
  }
  const start = (document as unknown as { startViewTransition: StartVT }).startViewTransition.bind(document)
  return start(async () => flushSync(update)).finished
}

/** Mount once in the shell: tells the pending transition the new route painted. */
export function useViewTransitionSettle() {
  const pathname = usePathname()
  useEffect(() => {
    settle?.()
    settle = null
  }, [pathname])
}

/** next/link that navigates through a view transition on a plain click. */
// Not generic: next/link only becomes generic once `next build` writes the
// typed-routes .d.ts, and CI typechecks before building.
export const TransitionLink = forwardRef(
  function TransitionLink({ onClick, href, ...props }: ComponentProps<typeof Link>, ref: Ref<HTMLAnchorElement>) {
    const router = useRouter()
    return (
      <Link
        ref={ref}
        href={href}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          onClick?.(e)
          if (
            e.defaultPrevented ||
            e.button !== 0 ||
            e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
            typeof href !== 'string' ||
            !canTransition()
          )
            return
          e.preventDefault()
          transitionTo(router, href as Route)
        }}
        {...props}
      />
    )
  },
)
