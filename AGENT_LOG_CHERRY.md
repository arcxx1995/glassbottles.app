# AGENT_LOG_CHERRY.md — UI/UX Product Designer

> Cherry's decisions on design system, visual language, Figma, and UX flows.

## Initialization
**Agent**: Cherry
**Role**: UI/UX Product Designer
**First Task**: Define design system, create Figma component library, design bottle metaphor

### Design System (Source of Truth)
See MASTER_PROMPT.md → Cherry Design Tokens section for canonical values.

### Figma MCP Setup
- Connect Figma MCP server before any design task
- All components annotated with props schema for Bella
- Design tokens exported to `tailwind.config.ts`

---
<!-- Cherry appends sessions below this line -->

## [2026-06-10] Session 1 — Full Design Audit
**Agent**: Cherry
**Task**: Audit every live component and screen against design tokens, brand principles, and UX quality bars. First logged design session.
**Files Read**: All components under `apps/web/components/`, all pages under `apps/web/app/`, `tailwind.config.ts`, `globals.css`, `app/layout.tsx`

---

### AUDIT NOTES — PRELIMINARY

`DESIGN.md` in this repo documents Wise's fintech design system — lime green, sage canvas, Wise Sans, currency converter cards. It has no relationship to glassbottles and will confuse any developer, agent, or collaborator who reads it expecting the glassbottles system. Flagged as CR-00/CR-07 below.

The canonical token source for glassbottles is `tailwind.config.ts` + `globals.css`, which correctly implement the spec. All six color primitives are present and correct.

---

### COMPONENT AUDITS

---

#### `tailwind.config.ts` + `globals.css` — Design Token Implementation
**Status: APPROVED with one critical gap**

All six color primitives match spec exactly: `ocean-deep #0A1628`, `ocean-mid #0D2137`, `seafoam #4ECDC4`, `sand #F7E7CE`, `coral #FF6B6B`, `glass rgba(255,255,255,0.08)`, `foam rgba(255,255,255,0.04)`. Font families correctly alias `display` to Playfair Display, `ui` to DM Sans, `mono` to JetBrains Mono. All four animation tokens are present: `wave-ambient 4s`, `bottle-bob 3s`, `fade-in`, `throw-arc` with the canonical `cubic-bezier(0.25,0.46,0.45,0.94)`. The `::selection` highlight using seafoam/ocean-deep is a nice touch.

Critical gap: All custom colors are defined as flat hex strings (e.g. `seafoam: '#4ECDC4'`). Tailwind v3's opacity modifier syntax (`bg-seafoam/10`, `text-seafoam/30`, `border-seafoam/20`) requires the color to be defined using the `<alpha-value>` interpolation format (e.g. `rgb(78 205 196 / <alpha-value>)`). With flat hex values, every opacity-modulated usage generates no CSS and renders as `transparent`. This silently breaks approximately 40+ class usages across 8 files. This is CR-01 and is P0.

`prefers-reduced-motion` is entirely absent from `globals.css` and from the entire codebase — no `@media (prefers-reduced-motion: reduce)` block, no Framer Motion reduced-motion hook, no conditional logic. This is CR-02 and is P0.

---

#### `app/layout.tsx` — Root Layout
**Status: APPROVED**

Font loading is correct: Playfair Display at weights 400 and 700, DM Sans at 400/500/600, JetBrains Mono at 400. CSS variables are properly exposed. `antialiased` is set on body. Metadata title/description match brand voice. No issues.

---

#### `WaveBackground.tsx`
**Status: CHANGE REQUEST**

The three-layer sinusoidal wave system is conceptually correct and the seafoam `#4ECDC4` fill matches spec. The `linear` easing on the x-translate scroll is correct for a seamless tile loop.

The ambient radial glow at `rgba(78,205,196,0.05)` is so faint it adds no perceivable depth on real devices — opacity should be at least `0.08` to register.

The gradient base uses two hardcoded hex values (`#0C1C2E`, `#091520`) that are not in the design token set. Both stops should use `var(--color-ocean-mid)` and `var(--color-ocean-deep)` so future token changes propagate automatically. This is CR-16.

Critical missing: No `prefers-reduced-motion` alternative. Three continuously scrolling layers plus a pulsing radial gradient is a genuine motion trigger for users with vestibular disorders. The reduced-motion path should collapse all wave animations to `animation: none` and fall back to a static gradient. This is part of CR-02.

---

#### `BottleCanvas.tsx`
**Status: APPROVED with change requests**

The SVG bottle is well-constructed. The layering (body fill → seafoam tint → refraction lines → scroll → glow overlay) creates genuine glass depth. Shine opacity values (`0.24` primary, `0.10` secondary) are well-judged. The composing glow overlay at `rgba(78,205,196,0.07)` with stroke at `0.35` is appropriate — present without being garish.

Bob animation: `y: [0, -10, 0]` at `3.2s` with `rotate: [-1.2, 1.2, -1.2]`. Duration is 3.2s vs the `bottle-bob` CSS token spec of 3s. Should be normalized to `duration: 3`. This is CR-18.

The composing pulse ring uses `border-radius: 50%` (circular) on a 160×240 rectangular container. The ring renders as a misaligned oval floating around the bottle shape with no visual relationship to the bottle silhouette. Replace with `filter: drop-shadow(0 0 8px rgba(78,205,196,0.3))` applied directly to the SVG element when `isComposing` is true, and remove the pulse ring div. This is CR-09.

No `prefers-reduced-motion` guard on the bob animation or entrance transition. Part of CR-02.

---

#### `ThrowAnimation.tsx`
**Status: CHANGE REQUEST**

The arc keyframes (`x: [0, 60, 200]`, `y: [0, -120, 40]`) at `0.85s` approximate a plausible parabolic throw. Rotation from 0 to 42° is natural tumble. The ripple ellipse at `delay: 0.72` fires at 85% of animation completion — correct, matches when the bottle hits the water.

Problem: the bottle starts at `left: 50%, top: 50%` of the ThrowAnimation container. In the composing state, the bottle lived at the top of the viewport inside BottleCanvas. The throw animation begins from a visually different position — it teleports then throws, breaking spatial continuity. Fix: use Framer Motion `layoutId="bottle"` on both the BottleCanvas motion wrapper and the ThrowAnimation bottle element so the throw continues from the bottle's last rendered position. This is CR-04.

Status text "Casting into the ocean…" at `text-sand/40` renders at approximately 3:1 contrast ratio on `ocean-deep` — below WCAG AA (4.5:1 for small text). Change to `text-sand/60`. This is CR-12.

No `prefers-reduced-motion` path. When reduced-motion is active, the throw sequence should call `onComplete` immediately on mount. Part of CR-02.

---

#### `MessageEditor.tsx`
**Status: APPROVED with change requests**

The textarea surface (`bg-glass border border-white/10`, `focus-within:border-seafoam/30`) is correct. Font choice `font-display` (Playfair Display) for the message body is exactly right — bottle content should feel literary. Placeholder copy "Write something for a stranger to find…" is on-brand. Footer copy "Anonymous. Be kind. Be honest." is excellent.

The character counter transitions correctly: `sand/25` → `sand/50` at 100 remaining → `coral` at over limit. The negative integer display when over limit (e.g. `-12`) is correct behavior and should not be clamped to 0.

The throw CTA button "Seal & Throw" uses the `🫙` jar emoji inline. Emoji render in system font within Playfair Display text, creating a typeface switch mid-label. Remove the emoji — "Seal & Throw" carries the meaning alone. This is part of broader emoji consistency noted in CR-24.

The idle home page CTA ("Write a message") has `px-10` fixed padding while this button uses `w-full`. On narrow screens the idle CTA feels undersized. The idle CTA should also be `w-full max-w-xs` for mobile-first consistency. This is CR-20.

No `prefers-reduced-motion` guard on button entrance animation. Part of CR-02.

---

#### `ReceivedBottle.tsx`
**Status: APPROVED with change requests**

The staggered word reveal uses `delay: 0.2 + Math.min(i * 0.025, 1.4)`. The cap at 1.4s correctly prevents very long messages from taking forever. However `i * 0.025` is 25ms per word — the design spec token is 40ms per word. This runs 37.5% faster than designed, making the reveal feel like a data dump rather than reading speed. Change to `i * 0.04`. This is CR-08.

Card styling (`rounded-3xl bg-ocean-mid border border-white/5`) is correct. Unread dot (`bg-seafoam`, `w-2 h-2`) correctly uses seafoam for informational accent.

Report button touch target: `p-2` around a 15px icon = 31px square, below the 44px WCAG minimum. Change to `p-3` and add `min-w-[44px] min-h-[44px]`. This is CR-10.

The `<article>` has no top-level `aria-label`. Screen reader users navigating by landmark cannot distinguish one bottle from another. Add `aria-label` composed from the date, e.g. `aria-label={\`Bottle received ${new Date(bottle.sent_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}\`}`. This is CR-23.

`toLocaleDateString` uses hardcoded `'en-US'` locale — should use `undefined` to respect the user's system locale. This is CR-25.

---

#### `AppShell.tsx`
**Status: APPROVED**

Clean and minimal. `WaveBackground` is correctly `dynamic` with `ssr: false`. `pb-20` on main clears the fixed bottom nav. `z-10` on main over `z-0` background — correct stacking. No issues.

---

#### `BottomNav.tsx`
**Status: CHANGE REQUEST**

Token usage is correct: `bg-ocean-mid/80 backdrop-blur-md border-t border-white/5`. Active state `text-seafoam`, inactive `text-sand/30 hover:text-sand/60` — correct. Unread badge uses `bg-coral text-ocean-deep` — correct, coral is the urgency accent.

The `Anchor` icon for the Bottle nav item is wrong. An anchor is a nautical metaphor for staying put — the opposite of the throw/release action. The `BottleSVG` component is already exported from `ThrowAnimation.tsx`. Replace the Anchor icon with `<BottleSVG width={14} height={22} />` to maintain consistent icon weight and reinforce the core metaphor. This is CR-03.

Nav label font size `text-[10px]` should be `text-[11px]` minimum to remain legible after system font size scaling on Android. This is CR-17.

---

#### `DailyTimer.tsx`
**Status: APPROVED with one note**

Font: `font-mono text-2xl tabular-nums` — correct. The `tabular-nums` class prevents layout shift as digits change. `pad()` function zero-pads correctly. UTC midnight calculation is correct. Separator colons at `text-sand/30` vs digits at `text-sand/60` is a good micro-detail.

The `useState(null)` + `useEffect` pattern correctly prevents hydration mismatch but creates an empty slot on mount (up to 1000ms) that causes layout shift in the thrown state. Return `--:--:--` as a static placeholder when `time` is null: `<p className="font-mono text-2xl text-sand/20 tabular-nums tracking-tight">--:--:--</p>`. This is CR-11.

---

#### `OceanCounter.tsx`
**Status: APPROVED**

Correctly ghosts at `text-[11px] text-sand/25` — ambient without demanding attention. `AnimatePresence` with `key={data.count}` correctly re-animates on count change. Singular/plural copy handled. `count === 0` guard suppresses zero state. `aria-live="polite"` is correct for non-critical ambient info. No issues.

---

#### `ReceivedBanner.tsx`
**Status: CHANGE REQUEST**

Spring animation (`stiffness: 320, damping: 28`) reads as a confident important interruption — correct. 5s auto-dismiss with linear progress bar is an excellent affordance.

The `🫙` emoji icon renders inconsistently across platforms — Apple, Android, and Windows each render it differently, and some Android systems may not have it. Replace with an inline `BottleSVG` at 16×24px with `style={{ filter: 'drop-shadow(0 0 6px rgba(78,205,196,0.4))' }}`. The scale pulse animation can be applied to the SVG wrapper. This is CR-05.

`fixed top-4` does not account for iOS safe-area notch (44–59px on iPhone 14 Pro/15 series). Change to `style={{ top: 'max(1rem, env(safe-area-inset-top))' }}`. This is CR-06.

`role="alert"` on a `<button>` is an ARIA conflict — `<button>` is interactive, `alert` is a live region. Screen readers announce it as both. Correct pattern: wrap the button in `<div role="alert" aria-live="assertive" aria-atomic="true">` and remove those attributes from the button itself. This is part of CR-05.

---

#### `BottleSkeleton.tsx`
**Status: APPROVED**

`rounded-[48px]` on the bottle ghost suggests the bottle's oval form rather than a generic rectangle. Dimensions `160×240` exactly match `BottleCanvas`. Text ghost sequence mirrors the three-element idle state layout. No issues.

---

#### `RealtimeBottleListener.tsx`
**Status: APPROVED**

No visual output. Stable Supabase ref, correct cleanup, correct table/filter targeting. No design concerns.

---

### PAGE AUDITS

---

#### `(app)/home/page.tsx`
**Status: CHANGE REQUEST**

The four-state machine (idle → composing → throwing → thrown) with `AnimatePresence mode="wait"` is the correct architecture.

Idle state: CTA "Write a message" uses `px-10 py-4` fixed padding — approximately 200px wide. Should be `w-full max-w-xs` to fill the content column on mobile consistently with the MessageEditor CTA. This is CR-20.

Thrown state: Uses `bg-seafoam/8` on the confirmation circle. This will render as transparent due to CR-01 (flat hex, no alpha-value support). Dependent on CR-01 fix.

Guest prompt: "Sign in to send your bottle" at `text-sand/20` is a functional prompt rendered at approximately 1.8:1 contrast — below even decorative threshold for meaningful UI text. Change to `text-sand/40`. This is a sub-item of CR-02 adjacent accessibility concerns.

---

#### `(app)/inbox/page.tsx`
**Status: CHANGE REQUEST**

Loading skeleton uses fading cascade at `opacity: 1, 0.7, 0.4` — correct idiom. Header subtitle "Bottles that found you" is excellent copy — approved.

Empty state uses the Lucide `Mail` icon. The metaphor is bottles, not email. Replace `<Mail>` with `<BottleSVG width={32} height={48} />` wrapped in an `opacity-20` container. This is CR-21.

Bottle list stagger delay `i * 0.06` (60ms per item) should be capped: `Math.min(i * 0.06, 0.3)` so the last item in a long list never waits more than 300ms.

---

#### `(app)/settings/page.tsx`
**Status: CHANGE REQUEST**

Currently contains only a sign-out row with no header subtitle — creates an abrupt layout after the heading. Add `<p className="font-ui text-sm text-sand/40 mt-1">Your account</p>` below the h1 to match the header pattern in other app pages. This is CR-22.

The sign-out row's icon container uses `bg-coral/10` — renders as transparent due to CR-01. Dependent on CR-01 fix.

`settings/loading.tsx` first skeleton card is `h-28` (112px) but the rendered sign-out row is approximately 56px tall. Change to `h-16` to prevent skeleton-to-content layout shift. This is CR-19.

---

#### `(auth)/sign-in/page.tsx`
**Status: CHANGE REQUEST**

Magic link flow is the correct auth UX. `AnimatePresence mode="wait"` on form → confirmation transition is correct.

Raw Supabase error messages are displayed directly (e.g. "Email rate limit exceeded"). These are clinical and off-brand. Add a `friendlyError()` mapping function before display. This is CR-15.

`rounded-3xl` on the input container vs `rounded-2xl` on the submit button creates a radius inconsistency within the same form. Both should be `rounded-3xl`, or both `rounded-2xl`. Prefer `rounded-3xl` to match the card-like container chrome.

No ocean atmosphere. Auth pages are outside `AppShell` and render on flat `bg-ocean-deep`. Add a static (non-animated) gradient background `div` at `z-0`. This is CR-13.

No bottle hero visual — the page jumps straight to the wordmark. Sign-up has a `🫙` bottle hero. Both auth pages should have the same visual hierarchy. This is CR-14.

---

#### `(auth)/sign-up/page.tsx`
**Status: CHANGE REQUEST**

All sign-in issues apply. Additionally:

Success copy "You're almost in 🌊" uses `🌊` emoji inline within `font-display` (Playfair Display) text. Emoji render in system font, creating a mid-sentence typeface switch. Extract the emoji to a separate element or replace with text: "You're almost in." This is CR-24.

No ocean atmosphere. Part of CR-13.

---

#### `(app)/error.tsx`
**Status: APPROVED**

"Rough waters" / "The ocean is unpredictable." is exactly the right tone. The ±6° rotating bottle correctly conveys instability without distress. "Try again" in `bg-seafoam/10 text-seafoam` is the correct secondary CTA weight for an error recovery action — not coral, not alarming. The `error.digest` in `font-mono text-[10px] text-sand/20` is a good developer affordance. No issues.

---

#### `not-found.tsx`
**Status: APPROVED with one note**

"Lost at sea" + "That page drifted away. Maybe it's in someone's inbox." — excellent. "Back to shore →" in seafoam is correct weight for recovery. No `WaveBackground` — renders on flat `bg-ocean-deep`. Adding the static ocean gradient (CR-13) would improve atmosphere.

---

#### `(app)/home/loading.tsx`, `inbox/loading.tsx`, `settings/loading.tsx`
**Status: APPROVED** (settings has CR-19 noted above)

Home loading correctly reuses `BottleSkeleton`. Inbox loading matches the actual page structure. `bg-ocean-mid animate-pulse` treatment is consistent.

---

### PRIORITIZED CHANGE REQUESTS

**P0 — Silent breaks, renders nothing, or blocks accessibility**

- **CR-01** (`tailwind.config.ts`): All custom colors are flat hex strings. Tailwind `/N` opacity modifiers generate no CSS without `<alpha-value>` format. Rewrite all custom colors: e.g. `seafoam: 'rgb(78 205 196 / <alpha-value>)'`, `coral: 'rgb(255 107 107 / <alpha-value>)'`, `ocean-deep: 'rgb(10 22 40 / <alpha-value>)'`, `ocean-mid: 'rgb(13 33 55 / <alpha-value>)'`, `sand: 'rgb(247 231 206 / <alpha-value>)'`. Affects ~40+ usages across 8 files. **Handoff to Bella — first commit.**

- **CR-02** (`globals.css` + `WaveBackground.tsx` + `ThrowAnimation.tsx` + `BottleCanvas.tsx`): Add `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }` to `globals.css`. In `WaveBackground`, conditionally suppress all motion with `usePrefersReducedMotion()`. In `ThrowAnimation`, call `onComplete()` in a `useEffect` on mount when reduced-motion is active. **Handoff to Bella — second commit.**

**P1 — Breaks UX or brand expression**

- **CR-03** (`BottomNav.tsx`): Replace Lucide `Anchor` with `BottleSVG` at 14×22px for the Bottle nav item. Anchor contradicts the throw/release metaphor.

- **CR-04** (`ThrowAnimation.tsx` + `BottleCanvas.tsx`): Add `layoutId="bottle"` to both the BottleCanvas motion wrapper and the ThrowAnimation bottle element. The current throw teleports then throws; layoutId makes it spatially continuous.

- **CR-05** (`ReceivedBanner.tsx`): Replace `🫙` emoji with `<BottleSVG width={16} height={24} />` with drop-shadow filter. Wrap component in `<div role="alert" aria-live="assertive" aria-atomic="true">` and remove those ARIA attrs from the `<button>`.

- **CR-06** (`ReceivedBanner.tsx`): Change `top-4` to `style={{ top: 'max(1rem, env(safe-area-inset-top))' }}` for iOS notch safety.

- **CR-07** (`DESIGN.md`): Replace current Wise fintech analysis with a glassbottles design system document. Cherry to author.

**P2 — Polish and consistency**

- **CR-08** (`ReceivedBottle.tsx`): Change word-reveal delay from `i * 0.025` to `i * 0.04` (40ms/word per spec token).

- **CR-09** (`BottleCanvas.tsx`): Replace composing pulse ring div with `filter: drop-shadow(0 0 8px rgba(78,205,196,0.3))` on the SVG when `isComposing`. The ring is geometrically misaligned to the bottle shape.

- **CR-10** (`ReceivedBottle.tsx`): Report button — change `p-2` to `p-3`, add `min-w-[44px] min-h-[44px]` to meet 44px WCAG touch target.

- **CR-11** (`DailyTimer.tsx`): Return `--:--:--` static placeholder (at `text-sand/20`) instead of `null` while `time` is null, preventing layout shift on mount.

- **CR-12** (`ThrowAnimation.tsx`): Change status text from `text-sand/40` to `text-sand/60` to meet WCAG AA contrast.

- **CR-13** (`sign-in/page.tsx`, `sign-up/page.tsx`, `not-found.tsx`): Add static ocean gradient background div (`bg-gradient-to-b from-ocean-deep via-[var(--color-ocean-mid)] to-[#091520]`) at `z-0 fixed inset-0`. No animation needed — static atmosphere only.

- **CR-14** (`sign-in/page.tsx`): Add `🫙` bottle hero element above the wordmark, matching sign-up page hierarchy. Both auth screens should open the same way.

- **CR-15** (`sign-in/page.tsx`, `sign-up/page.tsx`): Add `friendlyError(msg: string): string` mapping Supabase error strings to human copy before display. At minimum map rate-limit and generic errors.

- **CR-16** (`WaveBackground.tsx`): Replace hardcoded `#0C1C2E` and `#091520` gradient stops with `var(--color-ocean-mid)` and `var(--color-ocean-deep)`.

- **CR-17** (`BottomNav.tsx`): Change nav label from `text-[10px]` to `text-[11px]`.

- **CR-18** (`BottleCanvas.tsx`): Change bob animation `duration: 3.2` to `duration: 3` to match `bottle-bob` CSS token.

- **CR-19** (`settings/loading.tsx`): Change first skeleton card from `h-28` to `h-16` to match actual row height and prevent layout shift.

- **CR-20** (`home/page.tsx` idle CTA): Change `px-10 py-4` to `w-full max-w-xs py-4` to match MessageEditor CTA width.

- **CR-21** (`inbox/page.tsx` empty state): Replace `<Mail>` Lucide icon with `<BottleSVG width={32} height={48} />` in an `opacity-20` wrapper.

- **CR-22** (`settings/page.tsx`): Add `<p className="font-ui text-sm text-sand/40 mt-1">Your account</p>` below h1.

- **CR-23** (`ReceivedBottle.tsx`): Add `aria-label` to `<article>` composed from the bottle date for screen reader landmark navigation.

- **CR-24** (`sign-up/page.tsx`, `MessageEditor.tsx`): Extract inline emoji from Playfair Display strings into separate `font-ui` `<span>` elements or remove entirely. Affects "You're almost in 🌊" and "Seal & Throw 🫙".

- **CR-25** (`ReceivedBottle.tsx`): Change `toLocaleDateString('en-US', ...)` to `toLocaleDateString(undefined, ...)` to respect user system locale.

---

**Open Questions**:
- CR-01 is the highest-risk change — it will visually alter every component simultaneously when fixed. Bella should audit computed CSS before/after with browser devtools to confirm all opacity usages render correctly post-fix.
- CR-04 (layoutId shared animation) requires that `BottleCanvas` and `ThrowAnimation` are never simultaneously mounted. Current `AnimatePresence mode="wait"` guarantees this — implementation should be straightforward.
- CR-07 (`DESIGN.md` replacement) is Cherry's deliverable. Current `DESIGN.md` is a Wise fintech analysis with no relevance to this product. Scheduling needed.

---

**HANDOFF → Bella:**
P0 items CR-01 and CR-02 are unblocking — implement these before any visual polish work. CR-01 in `tailwind.config.ts` silently breaks ~40 class usages; it must be the first commit. CR-02 adds `prefers-reduced-motion` support across CSS and three motion components.

After P0: tackle CR-03, CR-05, CR-06, CR-10, CR-23 in a single component pass over `BottomNav.tsx`, `ReceivedBanner.tsx`, `ReceivedBottle.tsx`. Then CR-11, CR-12, CR-17, CR-18, CR-19 as quick single-file fixes. Then CR-13/CR-14 as an auth-pages pass.

Do not begin P2 items until CR-01 is merged and visually verified in the browser — many P2 items depend on the opacity system working correctly before judgment calls can be made.
