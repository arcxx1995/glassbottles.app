# AGENT_LOG_SOURYADEEP.md — UI/UX Product Designer

> Souryadeep's decisions on design system, visual language, Figma, and UX flows.

## Initialization
**Agent**: Souryadeep  
**Role**: UI/UX Product Designer  
**First Task**: Define design system, create Figma component library, design bottle metaphor

### Design System (Source of Truth)
See MASTER_PROMPT.md → Souryadeep Design Tokens section for canonical values.

### Figma MCP Setup
- Connect Figma MCP server before any design task
- All components annotated with props schema for Ishan
- Design tokens exported to `tailwind.config.ts`

---
<!-- Souryadeep appends sessions below this line -->

## [2026-06-11] Session 1
**Agent**: Souryadeep
**Task**: Full design audit — assess all outstanding design gaps, document missing tokens, fix UX inconsistencies, rebuild Settings page, and harden the design system.

**Files Changed**:
- `apps/web/tailwind.config.ts` — major expansion
- `apps/web/app/globals.css` — CSS custom properties, skeleton utility, focus ring system
- `apps/web/components/shared/BottleSkeleton.tsx` — migrated to `skeleton` utility
- `apps/web/app/(app)/settings/page.tsx` — full rebuild (was 1 button, now proper Settings)
- `apps/web/app/(app)/home/page.tsx` — thrown state: replaced emoji with BottleSVG
- `apps/web/app/page.tsx` — fixed pre-existing TS error (Variants type annotation)

**Decisions Made**:

1. **Design token expansion (tailwind.config.ts)**
   - Added semantic color aliases: `surface-0/1`, `text-primary/secondary/tertiary`, `border-subtle/active`. These are not additional colors — they are named intent layers over the raw palette, making Ishan's component work less error-prone.
   - Canonicalized `bottle-bob` keyframe to match BottleCanvas.tsx's Framer Motion values: `y: -10px, rotate: ±1.2deg, 3.2s`. The old keyframe used -6px/±1deg — now consistent. CSS version is reduced-motion fallback only.
   - Fixed `throw-arc` keyframe split: 55% peak (not 60%) matches ThrowAnimation.tsx's `times: [0, 0.55, 1]` exactly.
   - Added `shimmer` keyframe: `translateX(-100% → 100%), 1.6s ease-in-out infinite` — the standard loading sweep used in high-quality dark UIs.
   - Added `skeleton-pulse`: `opacity 1→0.4→1, 1.8s` — softer than Tailwind's default pulse which goes to full transparent.
   - Added `reveal-up` and `scale-in` — standard entrance animations needed for badges, counters, and content.
   - Added `transitionTimingFunction` tokens: `ease-quart` (easeOutQuart for content enters) and `ease-back` (back-spring for badge scale).
   - Added `boxShadow` vocabulary: `card`, `banner`, `seafoam`, `coral`, `glow-sm`, `glow-md`. Previously all drop-shadows were inline Tailwind arbitrary values — now canonical.
   - Added `borderRadius` vocabulary: `card` (24px), `button` (16px), `chip` (12px), `input` (24px).
   - Documented Framer Motion spring presets in comments: `reveal-bottle` (stiffness 80, damping 12) and `receive-spring` (stiffness 320, damping 28).
   - Documented spacing: 4px base grid, key page layout values (pt-14, h-16, pb-20).
   - Updated font family declarations to use CSS vars first (`var(--font-display)`) with fallbacks — Next.js font vars are the source of truth, the string names are fallback-only.

2. **globals.css hardening**
   - Added all design tokens as CSS custom properties (`--color-*`, `--space-*`, `--ease-*`). This gives non-Tailwind contexts (SVG, canvas, inline styles) access to canonical values.
   - `skeleton` utility class: combines `skeleton-pulse` opacity animation with a `::after` shimmer sweep. Usage: `className="skeleton rounded-xl"` — replaces ad-hoc `animate-pulse`.
   - Global `:focus-visible` ring: `2px solid seafoam, offset 2px`. Previously each component defined its own focus styles inconsistently (some used `focus-visible:ring-2 focus-visible:ring-coral`, some used `focus-visible:ring-seafoam`). Coral focus rings are wrong — coral is CTA-only.
   - Scrollbar: thinned to 4px (was 6px), track made transparent, thumb reduced to `seafoam/25` hover `seafoam/50`. Less intrusive on mobile-first layout.
   - Font family references `var(--font-ui)` rather than hardcoded string — consistent with layout.tsx injection.

3. **BottleSkeleton — shimmer upgrade**
   - Migrated from `animate-pulse` (bare opacity) to `skeleton` utility class (pulse + shimmer sweep). The shimmer provides directional motion cue that signals "loading in progress" more clearly than a plain fade.
   - Added `opacity: 0.7` to the second text ghost for visual hierarchy (less prominent than title ghost).

4. **Home page thrown state — emoji → SVG bottle**
   - The thrown state was using the `🫙` emoji inside a plain circle div. This is inconsistent with the bespoke SVG bottle used throughout (BottleCanvas, ThrowAnimation, landing page MiniBottle).
   - Decision: use `BottleSVG` (from ThrowAnimation.tsx) with `glowing={true}` to show the bottle is now "in the ocean" — the seafoam glow tint communicates "sent/live" state.
   - Added a radial gradient glow ring behind the bottle (analogous to the composing pulse ring in BottleCanvas) — creates the ambient "adrift in the ocean" feel the thrown state needs.
   - Added a gentle bob animation matching BottleCanvas parameters (y: 0/-8/0, rotate: -1/1/-1, 3.2s) — the bottle is now consistently bobbing whether in idle, thrown, or any other display context.
   - Dynamic import pattern: `BottleSVGDynamic` via `.then(m => ({ default: m.BottleSVG }))` — named export pattern for dynamic import of a non-default export.

5. **Settings page — rebuild from near-empty**
   - After WhatsApp removal (Ishan Session 6), Settings contained only a Sign Out button — 42 lines, no real content.
   - New structure: Privacy section (anonymous by design explainer), About section (how it works), Session section (sign out). Three sections with `SectionLabel` headers matching the font-mono/tracking-widest pattern used in other metadata.
   - Email display: sourced from `supabase.auth.getUser()` (Supabase Auth session), not from the `Profile` type (which correctly excludes email for anonymity). Shown in `font-mono text-xs text-sand/30` — readable but not prominent.
   - Member since: from `user.created_at` in the Profile store. Shows as "member since June 2026" — adds personalization without exposing anything sensitive.
   - Stagger animation: 7 elements staggered at 60ms intervals, 350ms each. Satisfying cascade entry.
   - `SettingsRow` component: keyboard-accessible (`role="button"`, `tabIndex`, `onKeyDown` for Enter/Space). Uses `div` not `button` to allow meta/description text layout — `button` is too restrictive for multi-line card rows.
   - Destructive variant (Sign Out): `coral/70 → coral` on hover, `hover:border-coral/20` — visually different from regular rows without being alarming at rest.
   - No `href`-based rows to avoid Next.js Link type issues — all interactive rows use `onClick`.

6. **Pre-existing TS bug fixed (app/page.tsx)**
   - `visualVariants` and `textVariants` in the `Beat` component were typed as `{}` in the reduced-motion branch. Framer Motion's `Variants` index signature requires `Variant` values (not `undefined`). Fixed by adding `: Variants` annotation and importing the type. Zero TS errors.

**Open Questions**:
- `SettingsRow` uses `div[role=button]` for keyboard accessibility. Akhilesh should verify this is preferable to `button` given the multi-line content structure, or flag if a `button` with `text-align: left` and explicit height would be cleaner.
- The `skeleton` utility's `::after` shimmer may conflict with other `::after` pseudo-elements on the same element. Flag to Ishan: don't add additional `::after` content on `.skeleton` elements.
- Settings page `supabase.auth.getUser()` call in `useEffect` is an extra auth round-trip on page mount. This is acceptable (email display is non-critical), but if Supabase session caching is in place, it may be served from cache. Kushal should confirm session caching behavior.
- The `BottleSVGDynamic` import pattern (named export via `.then(m => ({ default: m.BottleSVG }))`) is correct but slightly unusual. Ishan: if this pattern causes issues in some bundler edge cases, move `BottleSVG` to its own file `components/bottle/BottleSVG.tsx` with a default export.

**HANDOFF → Ishan**:
1. The `skeleton` CSS utility is ready. Audit all other `animate-pulse` usages in loading skeletons (home/loading.tsx ghost divs, inbox/loading.tsx ghost cards, settings/loading.tsx ghost cards) and migrate them to `className="skeleton"`. This is a purely visual upgrade — no logic change.
2. The `tailwind.config.ts` now has named box-shadow tokens (`shadow-card`, `shadow-banner`, `shadow-glow-sm`, etc.) and border-radius tokens (`rounded-card`, `rounded-button`, etc.). Audit existing components and replace arbitrary `rounded-3xl` + inline `boxShadow` values with these tokens for consistency. Priority: `ReceivedBottle` card uses `rounded-3xl border border-white/5` — should be `rounded-card border border-border-subtle`. `ReceivedBanner` uses `shadow-lg shadow-black/30` — should be `shadow-banner`.
3. The `thrown` state bottle now bobs using Framer Motion. Verify visually that the `BottleSVGDynamic` lazy load doesn't cause a flash — if it does, add a `fallback` prop to the dynamic import with a 80×120 transparent placeholder.
4. Settings page: the `useEffect` that calls `supabase.auth.getUser()` needs the `supabase` instance in its dependency array to be ESLint-safe — already included via closure capture. Verify no lint warnings.

**HANDOFF → Akhilesh**:
- Review `SettingsRow` accessibility: `div[role=button]` vs native `button` element. The multi-line card layout makes native `button` tricky (it's a replaced element with tight defaults) but Akhilesh may have a preferred pattern.
- Confirm `:focus-visible` global ring in `globals.css` doesn't conflict with component-level focus styles. Some components (sign-in button, home CTA) already define `focus-visible:ring-2 focus-visible:ring-coral` — those should be updated to use `focus-visible:ring-seafoam` (coral focus rings fail WCAG 3:1 on `ocean-deep` background). I've documented the global standard; Akhilesh should flag any remaining coral focus rings in code review.

