# AGENT_LOG_BELLA

## 2026-06-11 — RealtimeBottleListener sender-side + home page sailing/delivered states

### What was already there
- `apps/web/components/shared/RealtimeBottleListener.tsx` existed but only subscribed to the **receiver** channel (`receiver_id=eq.<userId>`). It invalidated RTK cache and showed the ReceivedBanner toast — inbox flow only. No sender-side subscription.
- Home page `thrown` state was a static "Bottle sent" with no branching for matched vs. unmatched.
- `uiSlice` had no `sentBottleMatched` flag.

### Changes

#### `apps/web/store/uiSlice.ts`
- Added `sentBottleMatched: boolean` to `UIState` (initial: `false`).
- Added `setSentBottleMatched` reducer action.
- Exported `selectSentBottleMatched` selector.

#### `apps/web/components/shared/RealtimeBottleListener.tsx`
- Added a second Supabase Realtime channel (`bottles:sender:<userId>`) subscribing to `UPDATE` on `bottles` filtered by `sender_id=eq.<userId>`.
- Guard in the callback: only dispatch `setSentBottleMatched(true)` when `payload.old.received_at == null && payload.new.received_at != null` — i.e., the bottle transitioned from unmatched to matched. Prevents spurious fires on unrelated column updates (is_read, is_stale, etc).
- Also invalidates `BottleStatus` tag on match so RTK cache reflects the new `received_at`.
- Payload typed as `{ old: Partial<Bottle>; new: Partial<Bottle> }` — no `any`.

#### `apps/web/app/(app)/home/page.tsx`
- Imports `selectSentBottleMatched` and `setSentBottleMatched` from uiSlice.
- Added seed effect: on initial status load, if `todayStatus.sentBottle.received_at != null` and flag is not yet set, dispatch `setSentBottleMatched(true)`. This handles the refresh case where the bottle was matched in a previous session.
- `thrown` state now has a fixed 160×160 container for the bottle+glow (prevents layout shift during sub-state transition).
- Glow ring color shifts from seafoam tint to coral tint when matched.
- Inner `AnimatePresence mode="wait"` cross-fades between two sub-states:
  - **"Still sailing"** (`sentBottleMatched === false`): heading + copy + `WaveIndicator` (three bouncing dots).
  - **"Found a stranger"** (`sentBottleMatched === true`): heading + copy + animated "Delivered" coral badge.
- Added `WaveIndicator` component (file-scoped, three Framer Motion dots staggered by 0.18s).
- Shared `BOB_TRANSITION` const extracted to avoid duplication.

### Decisions
- Kept `RealtimeBottleListener` as a single component mounting both channels rather than splitting into two — it already lives in app layout, a single `null`-render component with two effects is simpler than a second layout-level component.
- Used `AnimatePresence mode="wait"` for the sailing→delivered cross-fade so the exit animation finishes before the enter begins — avoids both states being visible during the transition.
- Did not add a "Bottle delivered" notification banner for the sender — the in-place state transition on the home page is sufficient, and adding a second banner type is out of scope for this task.
- `WaveIndicator` defined in the home page file rather than `components/shared/` — it is purely decorative and specific to this one state; extracting it would add indirection with no reuse benefit.

## 2026-06-11 — /preview dev page (all bottle UI states, no auth)

### What was built
`apps/web/app/preview/page.tsx` — a standalone dev preview route rendering all 7 home-page bottle states in tab-switchable panels.

### Auth bypass
`/preview` is **not listed** in `middleware.ts`'s `config.matcher` array. The matcher is an explicit allowlist (`/home`, `/inbox`, `/settings`, `/api/:path*`, `/sign-in`, `/sign-up`). Any path not in that list is never matched by the middleware, so `/preview` is unconditionally public. No middleware change required.

### Architecture
- Each panel owns an isolated Redux store instance (via `configureStore` + `preloadedState`) wrapped in its own `<Provider>`. Panel stores are independent; state in one panel cannot bleed into another.
- `bottleApi` and `authApi` reducers and middleware are included in every mock store so RTK Query mutation-calling components (`ReceivedBottle`) mount without errors. Any mutation fired (e.g. "Mark read") will receive a 401 from `/api` — acceptable in preview, the UI renders correctly.
- `OceanCounter` is excluded from panels because it calls `useGetBottleCountQuery` and skips when `user` is `null` — it would be a no-render; not worth the noise.
- `MessageEditor` is rendered in the composing panel with a pre-seeded `message` string so the "Seal & Throw" CTA renders visible.
- `ThrowAnimation` auto-restarts via `key` increment after `onComplete` fires (600ms delay) so the arc loops continuously in preview.
- `BottleSVGDynamic` uses the same dynamic-import `.then((m) => ({ default: m.BottleSVG }))` pattern as home page. `BottleSVG` is also imported statically as a direct import for the `ThrowingPanel` (unused — panel uses `ThrowAnimation` which imports `BottleSVG` internally).

### Panels implemented
| Tab label | Panel id | Key mock state |
|---|---|---|
| Idle | `idle` | `sendStatus: 'idle'`, no sailing pill |
| Idle + Sailing | `idle-sailing` | `sendStatus: 'idle'` + static sailing pill with mock date |
| Composing | `composing` | `sendStatus: 'composing'`, seeded message text |
| Throwing | `throwing` | `ThrowAnimation` with looping key |
| Thrown / Sailing | `thrown-sailing` | `sendStatus: 'thrown'`, `sentBottleMatched: false`, seafoam glow |
| Thrown / Delivered | `thrown-delivered` | `sendStatus: 'thrown'`, `sentBottleMatched: true`, coral glow + Delivered badge |
| Received | `received` | `ReceivedBottle` with `MOCK_RECEIVED_BOTTLE` fixture |

### Decisions
- Tabs over grid: a single-panel view at full mobile width is more representative of the real UI than 7 shrunken panels crammed side by side. The state pill + breadcrumb counter (`1 / 7`) makes the switcher clear.
- `AnimatePresence mode="wait"` on the panel swap so exit finishes before the new panel enters — avoids z-fighting between Framer Motion elements.
- DEV PREVIEW banner uses `bg-coral/90` (not a pseudo-element or overlay) — visible in every scroll position and obviously non-production.
- No new layout file — the preview page uses `WaveBackground` directly and does not opt into the `(app)` route group layout, so there is no BottomNav or AppShell wrapping it.
