// Shared motion vocabulary so everything in the app moves the same way.
// Apple's damping/response pairs (WWDC18 "Designing Fluid Interfaces") mapped
// onto motion's bounce + visualDuration. Critically damped (bounce 0) by
// default; bounce only after a gesture carried momentum into the motion.

/** Default UI spring: no overshoot. Reveals, toggles, presence. */
export const spring = { type: 'spring', bounce: 0, visualDuration: 0.35 } as const
/** Repositioning and shared-layout moves (nav pill, reorders). */
export const springMove = { type: 'spring', bounce: 0, visualDuration: 0.4 } as const
/** Sheet settling after the user let go of it. */
export const springSheet = { type: 'spring', bounce: 0.15, visualDuration: 0.3 } as const
/** After a flick or throw: a little overshoot, earned by the momentum. */
export const springFlick = { type: 'spring', bounce: 0.2, visualDuration: 0.4 } as const
/** Press-in / press-out feedback. */
export const springPress = { type: 'spring', bounce: 0, visualDuration: 0.12 } as const
/** Kept for existing callers; prefer `spring`. */
export const springSoft = spring

/** Tween ease for plain fades/entrances that nobody can grab. */
export const easeOut = [0.25, 0.46, 0.45, 0.94] as const

/** Where a flick would come to rest (px), from release velocity (px/s).
 *  Apple's exponential-decay projection; d≈0.998 scroll feel, 0.99 snappier. */
export function project(velocity: number, d = 0.998) {
  return ((velocity / 1000) * d) / (1 - d)
}

/** Progressive resistance past a boundary: follows less the further it goes. */
export function rubberband(overshoot: number, dimension: number, c = 0.55) {
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot))
}
