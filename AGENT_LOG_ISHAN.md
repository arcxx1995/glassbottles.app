# AGENT_LOG_ISHAN.md — Frontend Engineer

> Ishan's decisions on components, RTK store, animations, and pages.

## Initialization
**Agent**: Ishan  
**Role**: Frontend Engineer  
**First Task**: Set up Next.js 14 scaffold, RTK store, shadcn/ui, implement app shell

### Component Registry

| Component | Path | Status |
|---|---|---|
| AppShell | components/layout/AppShell.tsx | ✅ Done |
| BottomNav | components/layout/BottomNav.tsx | ✅ Done |
| BottleCanvas | components/bottle/BottleCanvas.tsx | ✅ Done |
| ThrowAnimation | components/bottle/ThrowAnimation.tsx | ✅ Done |
| MessageEditor | components/bottle/MessageEditor.tsx | ✅ Done |
| ReceivedBottle | components/bottle/ReceivedBottle.tsx | ✅ Done |
| WaveBackground | components/shared/WaveBackground.tsx | ✅ Done |
| DailyTimer | components/shared/DailyTimer.tsx | ✅ Done |

### Store

| File | Status |
|---|---|
| store/uiSlice.ts | ✅ Done |
| store/api/bottleApi.ts | ✅ Done (RTK Query) |
| store/api/authApi.ts | ✅ Done (RTK Query) |
| store/index.ts | ✅ Updated (RTK Query middleware) |

### Pages

| Page | Status |
|---|---|
| app/(app)/home/page.tsx | ✅ Done |
| app/(app)/inbox/page.tsx | ✅ Done |
| app/(app)/settings/page.tsx | ✅ Done |
| app/(auth)/sign-in/page.tsx | ✅ Done |
| app/(auth)/sign-up/page.tsx | ✅ Done |

---
<!-- Ishan appends sessions below this line -->

## Session 1 — 2026-06-07

**Built**: Full frontend from scratch. Zero TS errors (`tsc --noEmit` clean).

### Key decisions

- **WaveBackground**: dynamic imported (`ssr: false`) from AppShell. Three Framer Motion layers at different speeds (8s/11s/14s), seafoam color, low opacity. Fixed position z-0.
- **BottleCanvas**: Framer Motion enter/exit + separate inner motion.div for infinite bob (y: [0,-10,0], rotate: [-1.2,1.2,-1.2], 3.2s). SVG is 160×240px, always has explicit dimensions (no layout shift). Composing state adds seafoam glow overlay + pulse ring.
- **ThrowAnimation**: mounts = starts immediately. Framer Motion keyframe array x/y/rotate/opacity, `onAnimationComplete` fires `onComplete` callback. Ripple SVG delayed 0.72s for splash feel. Dynamic imported in home page.
- **BottleSVG**: exported from ThrowAnimation.tsx as shared atom (80×120px). Used by ThrowAnimation. BottleCanvas has its own larger SVG (160×240px) — kept independent.
- **MessageEditor**: auto-resize textarea, char count with color states (normal → sand/50 at ≤100 → coral at overflow). "Seal & Throw" CTA only appears when message.trim().length > 0.
- **ReceivedBottle**: staggered word-by-word reveal, delay capped at `Math.min(0.3 + i * 0.025, 1.4)` to prevent 8s reveals on long messages.
- **DailyTimer**: `useState(null)` init to avoid SSR hydration mismatch, populated in `useEffect`.
- **RTK Query**: bottleApi + authApi with proper tag invalidation. Both added to store with `.concat()` middleware chain. No `any`, strict TS throughout.
- **Home page state machine**: idle → composing → throwing → thrown. `AnimatePresence mode="wait"` wraps all states. ThrowAnimation auto-starts on mount, calls `handleAnimationComplete` via `onAnimationComplete`. API errors swallowed (animation completes regardless — Kushal's routes not built yet).
- **AppShell**: WaveBackground dynamic imported, BottomNav always rendered. `pb-20` on main for nav clearance.

### Needs from Kushal
- `/api/bottles/send` POST ✅ (Kushal shipped Session 1)
- `/api/bottles/status?userId=` GET ✅
- `/api/bottles/received?userId=` GET ✅
- `/api/bottles/:id/read` PATCH ✅
- `/api/bottles/:id/report` POST ✅
- `/api/profile` GET + PATCH ✅

---

## Session 2 — 2026-06-07 — Sprint 4: Polish + Safety

**Built**: Loading skeletons, error boundary, 404, Supabase Realtime, BottomNav unread dot, home page status hydration.

### Files Added

| File | Purpose |
|---|---|
| `app/not-found.tsx` | Global 404 — ocean-theme, link back to /home |
| `app/(app)/error.tsx` | App group error boundary — bottle wobble + retry |
| `app/(app)/home/loading.tsx` | Home route skeleton (uses BottleSkeleton) |
| `app/(app)/inbox/loading.tsx` | Inbox skeleton — 3 ghost cards, fading cascade |
| `app/(app)/settings/loading.tsx` | Settings skeleton — 2 ghost cards |
| `components/shared/BottleSkeleton.tsx` | Reusable 160×240 bottle placeholder, exact BottleCanvas dims |
| `components/shared/RealtimeBottleListener.tsx` | Supabase Realtime → RTK invalidation on bottle match |

### Files Updated

| File | Change |
|---|---|
| `app/(app)/layout.tsx` | Dynamic import + mount `RealtimeBottleListener` (ssr: false) |
| `app/(app)/home/page.tsx` | Wire `useGetTodayBottleStatusQuery`; init sendStatus from server; `BottleSkeleton` while loading |
| `components/layout/BottomNav.tsx` | Unread dot on Inbox tab; `useGetReceivedBottlesQuery` with 60s poll fallback |

### Key decisions

- **RealtimeBottleListener**: Supabase `postgres_changes` on `bottles` table `UPDATE` filtered by `receiver_id=eq.{userId}`. On event → `bottleApi.util.invalidateTags(['BottleStatus','ReceivedBottles'])`. Supabase client stable via `useRef` (avoid recreating per render). Mounted in `(app)/layout.tsx` so it runs for all app routes.
- **BottomNav unread dot**: `useGetReceivedBottlesQuery` in BottomNav with `pollingInterval: 60_000` as Realtime fallback. Badge capped at "9+" display. `aria-label` on badge for a11y.
- **Home page hydration**: Critical bug fixed — without `useGetTodayBottleStatusQuery`, every refresh showed "Your bottle awaits" even if user already sent. Effect guards with `sendStatus === 'idle'` to prevent overriding an active throw session. `isInitializing` flag (`user.id exists + isLoading + no data`) prevents flash.
- **error.tsx**: Single `(app)/error.tsx` catches all app route errors. `error.digest` shown as ref code for support. No page-level duplicates.
- **loading.tsx**: Each route has its own because the layouts differ. Home uses `BottleSkeleton` for exact-dim match.
- **TS**: `tsc --noEmit` clean, zero errors.

### Open items for Sprint 4 (Kushal/Akhilesh)
- Akhilesh: Review RLS UPDATE over-permission on `bottles` (flagged Session 1 by Kushal)
- Kushal: Admin flag/review UI for reported bottles
- Souryadeep: Final visual polish pass

---

## Session 4 — 2026-06-07 — Full Audit + Sprint Close

**Task**: Complete sprint — full codebase audit, confirm zero gaps.

### Audit findings

All files verified across Sessions 1–3. No regressions. No missing features.

| Check | Result |
|---|---|
| TS strict — no `any`, no `@ts-ignore` | ✅ Clean |
| RTK Query void queries (no userId param) | ✅ All 3 endpoints |
| Dynamic imports on heavy animations | ✅ ThrowAnimation, BottleCanvas, WaveBackground, RealtimeBottleListener |
| Explicit w/h on all animated elements | ✅ All inline style dims |
| Loading routes (home, inbox, settings) | ✅ All 3 present |
| Error boundary | ✅ `(app)/error.tsx` |
| 404 | ✅ `app/not-found.tsx` |
| Empty states | ✅ Inbox empty state |
| BottomNav unread badge | ✅ cap at 9+ with aria-label |
| Realtime subscription | ✅ RealtimeBottleListener |
| WhatsApp masking | ✅ `maskPhone()` in settings |
| globals.css @import removed | ✅ fonts via next/font only |
| notificationApi wired to store | ✅ reducer + middleware |
| console.log in prod code | ✅ None (console.error in error.tsx is intentional) |

### One dead-state observation

`selectIsAnimating` exported from `bottleSlice.ts` — never consumed. `setThrowAnimating(true/false)` dispatched from home page but no component reads this flag. State is accurate but unused. Not a bug; reserved for future use (e.g., WaveBackground intensity during throw). No action taken — removing would be premature.

### Ishan sprint checklist: DONE

All Sprint 1–4 tasks assigned to Ishan are complete. No open frontend items.

**HANDOFF → AKHILESH**: Full code review pass now due. Key areas:
1. RTK Query cache tag correctness (bottleApi, authApi, notificationApi)
2. Error states in all UI (loading, error, empty) — all three routes covered
3. Accessibility audit (aria-labels present on all interactive elements)
4. `console.error` in `error.tsx` is intentional (error reporting service hook) — flag only if policy requires removal
5. `ReceivedBottle` mutation triggers in onClick without explicit `void` — TypeScript accepts, mark as style-only if desired

---

## Session 5 — 2026-06-07 — Sprint 5 Frontend

**Task**: Sprint 5 audit, bug fixes, and new Sprint 5 features.

### Findings from audit

- `app/layout.tsx` had been modified between sessions (by another agent): added `AuthProvider`, `Analytics`, `SpeedInsights` imports. `@vercel/analytics` and `@vercel/speed-insights` were in `package.json` but not installed in `node_modules` — caused `tsc` to fail (2 errors). Fixed by running `pnpm install` at monorepo root.
- `AuthProvider` is a well-designed client component (bootstraps Redux authSlice from Supabase session, handles `onAuthStateChange`). No changes needed.
- `BottleSkeleton` had contradictory `aria-hidden="true"` + `aria-label` — screen readers would never announce the label because `aria-hidden` suppresses the element entirely. Fixed to `role="status"` + `aria-label`.
- `ReceivedBottle`: `reportBottle(bottle.id)` and `markRead(bottle.id)` returned promises that were neither awaited nor voided. These are RTK Query mutation trigger calls; the return value is a mutation result object with a `then` that should be voided if not handled. Added `void` to both.
- `uiSlice.showReceivedBanner` and `setShowReceivedBanner` were wired in the store but never consumed by any UI component — dead state.

### Files Added

| File | Purpose |
|---|---|
| `components/shared/OceanCounter.tsx` | Ambient "X bottles in the ocean today" counter; polls every 5 min |
| `components/shared/ReceivedBanner.tsx` | Slide-in toast when Realtime delivers a bottle; auto-dismisses in 5s |
| `app/api/bottles/count/route.ts` | GET route: counts today's non-stale bottles (aggregate, no PII) |

### Files Updated

| File | Change |
|---|---|
| `store/api/bottleApi.ts` | Added `BottleCountResponse` interface, `BottleCount` tag, `getBottleCount` query, exported `useGetBottleCountQuery` |
| `components/shared/BottleSkeleton.tsx` | Fixed `aria-hidden="true"` → `role="status"` (was suppressing aria-label) |
| `components/bottle/ReceivedBottle.tsx` | Added `void` to `reportBottle()` and `markRead()` onClick handlers |
| `components/shared/RealtimeBottleListener.tsx` | Added `setShowReceivedBanner(true)` dispatch on bottle delivery event |
| `app/(app)/layout.tsx` | Dynamic import + mount `ReceivedBanner` (ssr: false) |
| `app/(app)/home/page.tsx` | Import + render `OceanCounter` in both `idle` and `thrown` states |

### Key decisions

- **OceanCounter placement**: Shown in `idle` state (below the CTA, sets emotional context before writing) and `thrown` state (below DailyTimer, reinforces "you're not alone in this ocean"). Intentionally absent from `composing` and `throwing` states — user focus should be on the message, not stats.
- **OceanCounter data**: Counts non-stale bottles with `day_key = today`. Does not count unmatched bottles differently from matched — "in the ocean" means "in motion today" regardless of matching status. Simplest mental model.
- **OceanCounter auth**: Requires session. The route rejects with 401 if not authenticated. Could be made public, but the count is only meaningful in-app and auth prevents unauthenticated scraping of daily activity rates.
- **ReceivedBanner**: `role="alert"` + `aria-live="assertive"` for screen reader announcement. `aria-atomic="true"` so the full message is read, not just the changed portion. Auto-dismiss timer resets on re-trigger (if somehow two bottles arrive). Progress bar shows time remaining (5s linear).
- **ReceivedBanner layout**: `z-[100]` above BottomNav (`z-50`). `fixed top-4` to not conflict with the bottom nav. Width `calc(100%-2rem)` with max-w-sm to respect mobile margins. Spring physics for enter/exit — matches the "bottle physics" theme.
- **Dependency install**: `pnpm install` at monorepo root resolved the missing `@vercel/analytics@1.6.1` and `@vercel/speed-insights@1.3.1` packages that were in `package.json` but absent from `node_modules`.
- **TS**: `tsc --noEmit` clean, zero errors.

### Sprint 5 checklist (Ishan scope)

| Item | Status |
|---|---|
| Ambient bottle counter (OceanCounter) | ✅ Done |
| In-app Realtime toast (ReceivedBanner) | ✅ Done |
| A11y: BottleSkeleton aria fix | ✅ Done |
| A11y: ReceivedBottle void mutations | ✅ Done |
| Dependency: @vercel packages installed | ✅ Done |
| TS strict — zero errors | ✅ Clean |

**HANDOFF → AKHILESH**: Review Session 5 additions. Key areas:
1. `OceanCounter` — confirm the `/api/bottles/count` route RLS is acceptable (uses server client with authed user; counts aggregate, no row content exposed)
2. `ReceivedBanner` — confirm `role="alert"` + `aria-live="assertive"` is the correct accessibility pattern for a transient notification toast
3. The `void` additions to `ReceivedBottle` mutation handlers are now correct — mark that concern as resolved

---

## Session 6 — 2026-06-07 — WhatsApp Removal

**Task**: Remove all WhatsApp functionality from the frontend. No backwards compat, no feature flags.

### Files Deleted

| File | Reason |
|---|---|
| `store/api/notificationApi.ts` | 100% WhatsApp — entire file deleted |

### Files Updated

| File | Change |
|---|---|
| `types/index.ts` | Removed `whatsapp_number: string \| null` and `whatsapp_verified: boolean` from `Profile`; removed `WhatsAppLog` interface entirely |
| `store/api/authApi.ts` | Removed `whatsapp_number?: string \| null` from `UpdateProfileRequest` |
| `store/index.ts` | Removed `notificationApi` import, reducer registration, and middleware concat |
| `app/(app)/settings/page.tsx` | Full rewrite — stripped all WhatsApp state, hooks, handlers, `maskPhone`, and the WhatsApp card; only Settings header + Sign Out button remain |
| `components/providers/AuthProvider.tsx` | Removed `whatsapp_number: null` and `whatsapp_verified: false` from fallback `setUser` call; updated JSDoc comment ("but not whatsapp_number / timezone etc." → "but not timezone etc.") |

### Key decisions

- **settings/page.tsx**: Complete rewrite (not surgical edit) — the WhatsApp card was ~140 lines out of 170; nearly the entire component was WhatsApp logic. Result is a clean 42-line file.
- **notificationApi.ts**: Deleted outright per instructions. No stubs, no empty exports.
- **Remaining backend files**: `app/api/whatsapp/register/route.ts`, `app/api/whatsapp/verify-otp/route.ts`, `lib/whatsapp/client.ts`, and the `whatsapp_*` fields in `app/api/profile/route.ts` were not touched — they are outside the specified frontend scope.
- **TS**: All WhatsApp references in the six specified files are gone. The `Profile` type no longer carries `whatsapp_number` or `whatsapp_verified`, which will cause compile errors in any other file that reads those fields — those files are backend routes and are outside this changeset.

---

## Session 3 — 2026-06-07 — Sprint Completion

**Built**: notificationApi, WhatsApp masking + opt-out, RTK void cleanup, font dedup.

### Files Added

| File | Purpose |
|---|---|
| `store/api/notificationApi.ts` | RTK Query for WhatsApp: `registerWhatsApp`, `removeWhatsApp` |

### Files Updated

| File | Change |
|---|---|
| `store/index.ts` | Added notificationApi reducer + middleware |
| `store/api/bottleApi.ts` | `getTodayBottleStatus` + `getReceivedBottles` → `void` (routes use session, not userId) |
| `store/api/authApi.ts` | `getProfile` → `void` (same reason) |
| `app/(app)/home/page.tsx` | Call site: `useGetTodayBottleStatusQuery(undefined, { skip: !user?.id })` |
| `app/(app)/inbox/page.tsx` | Call site: `useGetReceivedBottlesQuery(undefined, ...)` |
| `app/(app)/settings/page.tsx` | notificationApi for register/remove; view/edit mode; phone masking (••••XXXX); E.164 hint; explicit opt-out |
| `components/layout/BottomNav.tsx` | Call site: `useGetReceivedBottlesQuery(undefined, ...)` |
| `app/globals.css` | Removed redundant `@import url(googleapis...)` — next/font handles fonts |

### Key decisions

- **notificationApi**: Separate slice per MASTER_PROMPT architecture. No tagTypes defined — cross-slice invalidation done via `dispatch(authApi.util.invalidateTags(['Profile']))` in settings component after mutation resolves. RTK-blessed pattern for cross-slice cache busting.
- **Phone masking**: `maskPhone("+919876543210")` → `"+91 ••••3210"`. Keeps country code readable (diagnostically useful), hides middle digits. View/edit modal pattern: saved number shows masked display + Pencil + X; no saved number shows input immediately.
- **Opt-out**: `removeWhatsApp` mutation PATCH `/api/profile` with `{ whatsapp_number: null }` → Kushal's route clears number + sets `whatsapp_verified: false`. Both `removeWhatsApp` (notificationApi) and `updateProfile` (authApi) called in sequence to keep RTK Profile cache consistent.
- **void queries**: `userId` param removal. All three endpoints (bottleStatus, receivedBottles, profile) now take `void`. Skip condition still guards against unauthed calls via `{ skip: !user?.id }`. Call sites use `query(undefined, { skip })` — standard RTK Query void pattern.
- **globals.css**: `@import url()` + `next/font/google` caused double font network request. Removed `@import`. Font CSS vars (`--font-display`, `--font-ui`, `--font-mono`) are injected by Next.js via layout.tsx className.
- **TS**: `tsc --noEmit` clean, zero errors.

---

## Session 7 — 2026-06-11 — Design Token Alignment + Integration Gaps

**Task**: Close integration gaps from Souryadeep Session 1 design changes. Align BottleCanvas/ThrowAnimation with corrected token values. Migrate loading skeletons to `skeleton` utility. Apply shadow/radius token vocabulary. Fix thrown-state bob drift. Add BottleSVGDynamic fallback. Implement sign-in redirect for authenticated users.

**Files Changed**:

| File | Change |
|---|---|
| `apps/web/app/(app)/home/page.tsx` | Corrected thrown-state bob to canonical values; added `loading` fallback to `BottleSVGDynamic` |
| `apps/web/app/(app)/home/loading.tsx` | Migrated header ghost from `animate-pulse` to `skeleton` utility |
| `apps/web/app/(app)/inbox/loading.tsx` | Migrated all ghosts from `animate-pulse` + `bg-ocean-mid` to `skeleton`; card ghosts now use `rounded-card` token |
| `apps/web/app/(app)/settings/loading.tsx` | Migrated all ghosts from `animate-pulse` to `skeleton`; card ghosts use `rounded-card` token |
| `apps/web/components/bottle/ReceivedBottle.tsx` | `rounded-3xl border-white/5` -> `rounded-card border-border-subtle shadow-card` |
| `apps/web/components/shared/ReceivedBanner.tsx` | `shadow-lg shadow-black/30` -> `shadow-banner` |
| `apps/web/middleware.ts` | Added `isAuthRoute` check; authenticated users visiting `/sign-in` or `/sign-up` redirect to `/home`; added both paths to matcher |

**Decisions Made**:

- **BottleCanvas bob already correct**: `BottleCanvas.tsx` uses `y: [0,-10,0], rotate: [-1.2,1.2,-1.2], duration: 3.2s` — matches tailwind.config.ts `bottle-bob` token exactly. No change needed.
- **ThrowAnimation times already correct**: `times: [0, 0.55, 1]` matches the `55%` apex split in tailwind.config.ts `throw-arc` keyframe. No change needed.
- **Thrown-state bob corrected**: home/page.tsx thrown state had `y: [0,-8,0], rotate: [-1,1,-1]` — drifted from the canonical `-10px / 1.2deg`. Fixed to match `bottle-bob` token. Added explicit `times: [0, 0.5, 1]` for parity with BottleCanvas.
- **BottleSVGDynamic fallback**: Added `loading: () => <div style={{ width: 80, height: 120 }} aria-hidden />` so the thrown-state layout does not reflow when the SVG chunk loads. Dimensions match `BottleSVG` default props exactly.
- **Skeleton migration rationale**: All three loading routes used bare `animate-pulse bg-ocean-mid`. Migrated to `skeleton` utility which adds the shimmer sweep on top of the pulse — matches BottleSkeleton. Inline `opacity: 0.6` on secondary ghosts replaces the old `bg-ocean-mid/60` split (same visual result, cleaner CSS model).
- **Token migration**: `ReceivedBottle` now uses `rounded-card` (24px), `border-border-subtle` (white/5 alias), and `shadow-card`. `ReceivedBanner` now uses `shadow-banner`. Arbitrary Tailwind values eliminated from both components. Visual result is identical — tokens resolve to the same values that were previously hardcoded.
- **Sign-in redirect**: `isAuthRoute` added to middleware covering `/sign-in` and `/sign-up`. Exact-path match (not `startsWith`) to avoid matching deep auth sub-routes. Both paths added to `matcher` config. Resolves Kushal Session 9 deferred item.
- **TS**: `tsc --noEmit` clean, zero errors before and after all changes.

**Open Questions**:
- `SettingsRow` in settings/page.tsx uses `rounded-3xl` — should be `rounded-card` (same visual, token cleanup). Not urgent.
- The emoji `🫙` in `ReceivedBanner` pulse animation could be replaced with `BottleSVG` for full SVG consistency. Deferred to Souryadeep visual polish pass.

**HANDOFF -> AKHILESH**:
1. Middleware now redirects authenticated users from `/sign-in` and `/sign-up` to `/home`. Verify no redirect loop with Supabase magic link callback flow — magic link should land on `/auth/callback`, not directly on `/sign-in`, so no loop expected. Please confirm.
2. `ReceivedBottle` now uses `shadow-card` (`0 4px 24px rgba(0,0,0,0.3)`) — verify this renders acceptably at `mx-4` container width (shadow not clipped by overflow).
3. `SettingsRow` `div[role=button]` accessibility question remains open from Souryadeep Session 1. Please resolve.
