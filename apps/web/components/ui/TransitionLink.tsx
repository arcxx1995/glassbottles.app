'use client'

import { forwardRef, useEffect, type ComponentProps, type MouseEvent, type ReactElement, type Ref } from 'react'
import type { Route } from 'next'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

// Route changes as a View Transition: the old page cross-fades out, the new
// one lifts in, and elements sharing a `view-transition-name` (nav pill,
// bottle) morph between pages. CSS lives in globals.css. Browsers without the
// API, and reduced motion, get Next's normal instant swap.

type StartVT = (cb: () => Promise<void>) => unknown

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

/** Mount once in the shell: tells the pending transition the new route painted. */
export function useViewTransitionSettle() {
  const pathname = usePathname()
  useEffect(() => {
    settle?.()
    settle = null
  }, [pathname])
}

/** next/link that navigates through a view transition on a plain click. */
type LinkPropsFor<R> = ComponentProps<typeof Link<R>>

// Generic like next/link, so typed routes still check `/u/${handle}` hrefs.
export const TransitionLink = forwardRef(
  function TransitionLink<R>({ onClick, href, ...props }: LinkPropsFor<R>, ref: Ref<HTMLAnchorElement>) {
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
) as <R>(props: LinkPropsFor<R> & { ref?: Ref<HTMLAnchorElement> }) => ReactElement
