# Changelog

All notable changes to glassbottles.app are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — 2026-06-07

> Sprint 0–4 initial build. All changes sourced from agent logs (Bella × 3, Felix × 4, Shiv × 1, Nagoya × 1 sprint review). No formal version tag yet.

### Added

**Infrastructure (Shiv — Session 1)**
- pnpm 9.x monorepo with workspaces (`apps/web`, `apps/dashboard`)
- `package.json` root with `-r` delegate scripts
- `pnpm-workspace.yaml`
- `.gitignore`
- `.env.example` with all required variables
- `apps/web/next.config.ts`, `tsconfig.json` (strict mode), `tailwind.config.ts`, `postcss.config.js`, `.eslintrc.json`
- `.github/workflows/ci.yml` — lint + typecheck + test on PR (`--frozen-lockfile`)
- `.github/workflows/deploy.yml` — Vercel prod deploy on push to `main`
- `apps/dashboard/server.mjs` — Express + SSE agent monitoring server (port 3333, localhost-only)
- `apps/dashboard/public/index.html` — agent dashboard UI

**Backend (Felix — Sessions 1–3)**
- Supabase migrations: `001_init_schema.sql`, `002_rls_policies.sql`, `003_cron_jobs.sql`
- `supabase/config.toml` — Supabase CLI init, `project_id: glassbottles`
- `supabase/.gitignore`
- `lib/supabase/client.ts` — browser Supabase client
- `lib/supabase/server.ts` — SSR-safe Supabase client
- `lib/supabase/service.ts` — service role client (admin ops only)
- `lib/whatsapp/client.ts` — WhatsApp Cloud API client (1+1 retry, 1s delay)
- `app/api/bottles/send/route.ts` — POST: validate quota → insert bottle → fire-and-forget match
- `app/api/bottles/status/route.ts` — GET: today's send status (session-derived)
- `app/api/bottles/received/route.ts` — GET: received bottles (`sender_id` never selected)
- `app/api/bottles/[id]/read/route.ts` — PATCH: mark bottle read
- `app/api/bottles/[id]/report/route.ts` — POST: flag `is_reported`
- `app/api/profile/route.ts` — GET + PATCH: profile including WhatsApp number (owner only)
- `app/api/whatsapp/register/route.ts` — POST: save + verify WhatsApp number (E.164)
- `supabase/functions/match-bottle/index.ts` — edge function: random receiver assignment
- `supabase/functions/send-whatsapp/index.ts` — edge function: WhatsApp Cloud API call + log

**Frontend (Bella — Sessions 1–3)**
- Next.js 14 App Router scaffold, zero TypeScript errors
- `components/layout/AppShell.tsx` — shell with WaveBackground (dynamic import, ssr:false)
- `components/layout/BottomNav.tsx` — bottom nav with unread dot (RTK Query + 60s poll fallback)
- `components/bottle/BottleCanvas.tsx` — animated bottle (Framer Motion bob 3.2s, 160×240px SVG)
- `components/bottle/ThrowAnimation.tsx` — throw arc animation (keyframe + ripple SVG delayed 0.72s)
- `components/bottle/MessageEditor.tsx` — auto-resize textarea, char count, color states
- `components/bottle/ReceivedBottle.tsx` — staggered word-by-word reveal (capped at 1.4s)
- `components/shared/WaveBackground.tsx` — three Framer Motion wave layers (8s/11s/14s)
- `components/shared/DailyTimer.tsx` — countdown to midnight UTC (SSR-safe: `useState(null)` init)
- `components/shared/BottleSkeleton.tsx` — 160×240 loading placeholder matching BottleCanvas dims
- `components/shared/RealtimeBottleListener.tsx` — Supabase `postgres_changes` → RTK invalidation
- `store/uiSlice.ts` — modal/animation/theme local state
- `store/api/bottleApi.ts` — RTK Query: `sendBottle`, `getTodayBottleStatus`, `getReceivedBottles` (void, session-based)
- `store/api/authApi.ts` — RTK Query: `getProfile` (void, session-based)
- `store/api/notificationApi.ts` — RTK Query: `registerWhatsApp`, `removeWhatsApp`
- `store/index.ts` — RTK store with all reducers + middleware chain
- `app/(auth)/sign-in/page.tsx`, `app/(auth)/sign-up/page.tsx`
- `app/(app)/home/page.tsx` — state machine: idle → composing → throwing → thrown
- `app/(app)/inbox/page.tsx`
- `app/(app)/settings/page.tsx` — WhatsApp opt-in, phone masking (`••••XXXX`), view/edit modal
- `app/(app)/layout.tsx` — mounts `RealtimeBottleListener` (dynamic import, ssr:false)
- `app/(app)/error.tsx` — single app-group error boundary
- `app/(app)/home/loading.tsx`, `inbox/loading.tsx`, `settings/loading.tsx` — route skeletons
- `app/not-found.tsx` — ocean-theme 404

### Changed

**Backend (Felix — Sessions 1–3)**
- `supabase/config.toml` — corrected `project_id` from `"supabase"` (default) to `"glassbottles"`
- `supabase/functions/send-whatsapp/index.ts` — `receiver_id` now saved to `whatsapp_logs.receiver_id` (was always NULL)

**Frontend (Bella — Session 3)**
- `store/api/bottleApi.ts` — `getTodayBottleStatus` + `getReceivedBottles` query arg: `userId` → `void`
- `store/api/authApi.ts` — `getProfile` query arg: `userId` → `void`
- `app/(app)/home/page.tsx` — call site updated to `useGetTodayBottleStatusQuery(undefined, { skip: !user?.id })`
- `app/(app)/inbox/page.tsx` — call site updated to `useGetReceivedBottlesQuery(undefined, ...)`
- `components/layout/BottomNav.tsx` — call site updated to `useGetReceivedBottlesQuery(undefined, ...)`

### Fixed

**Security — Race Condition (Felix — Session 1)**
- Added `UNIQUE (sender_id, day_key)` constraint (`004_bottle_send_uniqueness.sql`) — atomic duplicate-send prevention; previous RLS quota check was non-atomic

**Security — SQL Injection (Felix — Session 3)**
- `match-bottle` edge function: replaced template-literal `'${bottle.day_key}'` subquery with parameterised two-step query via `.eq()` filters

**Security — RLS Over-permission (Felix — Session 3)**
- `005_rls_column_restriction.sql`: `REVOKE UPDATE ON bottles FROM authenticated` + `GRANT UPDATE (is_read, read_at, is_reported) ON bottles TO authenticated` — receiver was previously able to update all columns

**Security — XSS in Dashboard (Felix — Session 4, also fixed mid-session by unknown agent)**
- `apps/dashboard/public/index.html`: `renderNodes`, `renderExistingTags`, `renderAtDropdown` rewritten to use `createElement`/`textContent`/`addEventListener` — previously interpolated `node.name`, `node.path`, `t.label`, `t.color` into `innerHTML` unescaped
- `apps/dashboard/server.mjs`: added server-side input validation on `POST /api/tags` — allowlist for colors, regex for labels, 500-char path cap

**Frontend (Bella — Session 2)**
- Home page hydration bug: without `useGetTodayBottleStatusQuery`, every refresh showed "Your bottle awaits" even after sending. Fixed with status query + `isInitializing` guard.

**Frontend (Bella — Session 3)**
- Removed redundant `@import url(googleapis...)` from `app/globals.css` — caused double font network request alongside `next/font/google`

**Data Integrity (Felix — Session 3)**
- `whatsapp_logs.receiver_id` was always NULL (FK present but never populated). `match-bottle` now passes `receiver_id` in `send-whatsapp` invocation body.

### Added (Sprint 3–4 continuation)

**Backend (Felix — Session 3)**
- `supabase/migrations/006_match_retry_cron.sql` — `retry_unmatched_bottles()` SQL function + pg_cron at `:30` past every hour. Implements "queued, matched next available day" edge case (Nagoya spec).

---

*Sources: AGENT_LOG_BELLA.md × 3 sessions, AGENT_LOG_FELIX.md × 4 sessions, AGENT_LOG_SHIV.md × 1 session, AGENT_LOG_NAGOYA.md Sprint 1 review. Entries authored by Kitty 2026-06-07.*
