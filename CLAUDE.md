# glassbottles.app — Engineering Guide (CLAUDE.md)

> **One bottle. One stranger. Every day.** A quiet anti-social network: write one
> message, cast it into the sea, and ~an hour later it drifts to a random stranger
> somewhere in the world. No replies, no profiles, no feed, no algorithm.
> Anonymity is enforced at the database layer, not hidden in the UI.

This file is the single source of truth for an agent picking up the codebase cold.
It documents the build, the working mechanism end-to-end, the frontend, the backend,
every RPC, every Edge Function, every cron, and the hard rules. Read it fully before
touching anything.

---

## 0. RTK (Rust Token Killer) — token-optimized commands

**Golden rule: prefix every shell command with `rtk`.** If RTK has a dedicated
filter it uses it; otherwise it passes the command through unchanged, so `rtk` is
always safe. This applies inside `&&` chains too.

```bash
# ❌ git add . && git commit -m "msg" && git push
# ✅ rtk git add . && rtk git commit -m "msg" && rtk git push
```

Common filters used here (savings in parens): `rtk next build` (87%), `rtk tsc`
(83%), `rtk lint` (84%), `rtk vitest` (99.5%), `rtk git status|log|diff` (59–80%),
`rtk gh pr view|checks` (87/79%), `rtk pnpm install` (90%), `rtk supabase ...`
(passthrough). Meta: `rtk gain` (savings stats), `rtk proxy <cmd>` (run raw, for
debugging), `rtk discover` (find missed opportunities). Git passthrough covers ALL
subcommands even if not explicitly listed.

---

## 1. Hard rules (read before writing any code)

1. **No `pollingInterval` against a Vercel `/api/*` route.** Polling a
   `fetchBaseQuery('/api')` endpoint bills a Function invocation + provisioned-memory
   wall-clock time *per tick, per open tab, around the clock*. This caused the June
   2026 Fluid usage bloat. Poll **only** RTK Query endpoints whose `queryFn` calls
   Supabase directly (`rpc`/`select` — zero Vercel compute), and always pair with
   `skipPollingIfUnfocused: true`. Enforced by ESLint `no-restricted-syntax` in
   `apps/web/.eslintrc.json`; Supabase-direct polls opt out with an
   `// eslint-disable-next-line no-restricted-syntax -- polls a Supabase RPC ...`
   comment stating the target.
2. **Never run `supabase config push`.** `supabase/config.toml` holds *local-dev*
   auth values (`site_url = http://127.0.0.1:3000`, a partial redirect allow-list).
   Pushing it overwrites the production Supabase Auth config and breaks login for
   everyone. Set production email templates / redirect URLs in the Supabase
   **dashboard**. `supabase db push` (migrations only) is the safe deploy path.
3. **Anonymity is structural, never cosmetic.** `sender_id` / `receiver_id` must
   never leave the database to a client. Client reads go through SECURITY DEFINER
   RPCs that return only safe columns; Realtime payloads carry only a `bottle_id`.
   Do not add a client `.select()` that touches identity columns (the column-level
   ACL will reject it anyway — see §9).
4. **The service-role key is server-only.** It lives in API route handlers and Edge
   Functions exclusively. Never import `lib/supabase/service.ts` into a
   `'use client'` bundle.
5. **The 1-hour-adrift rule is the product.** A thrown bottle cannot be matched for
   at least one hour, no matter how many eligible receivers exist. Do not add an
   instant / send-time match. See §5.
6. **Reads off Vercel.** Default a new read to a Supabase-direct SECURITY DEFINER
   RPC, not a new `/api/*` route. Only write paths that genuinely need the service
   role or server secrets belong on a Vercel Function — even the throw and the mood
   check-in are RPCs (`send_bottle` mig 024, `check_in_mood` mig 025).
7. **Migrations are append-only and numbered.** Never edit an applied migration —
   add a new one.

---

## 2. Tech stack & repo shape

| Layer | Choice |
|---|---|
| Framework | Next.js **14.2.21** (App Router, React 18, TypeScript 5.5, strict) |
| Styling | Tailwind CSS 3.4, custom ocean / night-sky design system |
| Animation | Framer Motion 11 |
| State / data | Redux Toolkit 2 + RTK Query |
| Backend | Supabase — Postgres 17, Auth, Realtime, Edge Functions (Deno 2), pg_cron, pg_net |
| Auth | Supabase Auth (Google OAuth + email/password); middleware verifies JWTs locally via `getClaims()` |
| Email | Resend (SMTP transport for auth emails + HTTP API for notifications) |
| Hosting | Vercel (Fluid Compute); prod `glassbottles.app`, staging `test.glassbottles.app` |
| Monorepo | pnpm 9 workspaces (`apps/web`, `apps/dashboard`) |
| Tooling | ESLint, Vitest, `@vercel/analytics` + `@vercel/speed-insights` |

```
glassbottles/
├─ apps/
│  ├─ web/                         # the Next.js app (workspace name: "web")
│  │  ├─ app/
│  │  │  ├─ (app)/                 # authed: home, inbox, settings (+ AppShell, BottomNav)
│  │  │  ├─ (auth)/                # sign-in, sign-up, forgot-password, reset-password
│  │  │  ├─ auth/callback/route.ts # single PKCE / OTP code-exchange landing
│  │  │  ├─ api/                   # the few remaining Vercel routes (see §7)
│  │  │  ├─ page.tsx               # landing page (hero, live counters, example bottle)
│  │  │  ├─ landing-page.tsx, preview/, shot/, manifest.ts, layout.tsx, globals.css
│  │  ├─ components/               # bottle/, mood/, layout/, shared/, providers/, auth/
│  │  ├─ store/                    # Redux slices + RTK Query apis (bottleApi, authApi)
│  │  ├─ lib/supabase/             # client.ts (browser), server.ts (SSR), service.ts (service role)
│  │  ├─ lib/utils.ts              # cn() = twMerge(clsx())
│  │  ├─ types/index.ts            # Profile, Bottle, DailyQuota, Mood, status enums
│  │  └─ middleware.ts             # auth gate via getClaims()
│  └─ dashboard/                   # internal ops dashboard (express + chokidar, node server.mjs)
├─ supabase/
│  ├─ migrations/                  # 001 … 025 — schema, RLS, RPCs, matcher, cron, stats, mood/streak
│  ├─ functions/                   # Edge Functions: match-bottle, notify-receiver
│  ├─ templates/                   # branded auth emails (confirmation, recovery, email-change)
│  ├─ seed.sql                     # local-dev only (guards on db name 'postgres')
│  └─ config.toml                  # LOCAL Supabase config — do NOT `config push` (rule §1.2)
├─ .github/workflows/              # ci.yml (lint/typecheck/test on PR), deploy.yml (Vercel)
├─ docs/                           # PRODUCT_SPEC.md, FUNDRAISING.md, superpowers specs
└─ pnpm-workspace.yaml
```

---

## 3. Build, run, deploy

```bash
pnpm install            # workspace deps (Node ≥20, pnpm ≥9)
pnpm dev                # runs apps/web (Next dev) on :3000
pnpm build              # pnpm -r build
pnpm typecheck          # tsc --noEmit across workspace
pnpm lint               # next lint across workspace
pnpm test               # vitest run across workspace
pnpm dashboard          # node apps/dashboard/server.mjs (internal ops dashboard)
```

`apps/web` scripts mirror these (`next dev`, `next build`, `next start`, `next lint`,
`tsc --noEmit`, `vitest run`). `next.config.mjs` sets `experimental.typedRoutes` and
AVIF/WebP image formats. `apps/web/vercel.json` pins framework `nextjs`,
`installCommand: pnpm install --frozen-lockfile`, `buildCommand: pnpm build`,
`outputDirectory: .next`.

**CI** (`.github/workflows/ci.yml`): on PR to `main` → typecheck, lint, test.
**Deploy** (`.github/workflows/deploy.yml`): PR → Vercel preview; push to `main` →
Vercel production (`--prod`, `working-directory: apps/web`). Build env vars come from
GitHub secrets (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV`).

**Database deploy:** `supabase db push` applies migrations (safe). Edge Functions:
`supabase functions deploy match-bottle notify-receiver`. Edge Function / cron
secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`RESEND_FROM_ADDRESS`, and the `app.settings.*` runtime settings used by pg_net) are
set on the Supabase project, never committed.

### Environment variables (`.env.example`)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser + SSR clients.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only** (API routes, Edge Functions). Bypasses RLS.
- `RESEND_API_KEY` (also a Supabase secret), `RESEND_FROM_ADDRESS`
  (default `glassbottles <hello@glassbottles.app>`).
- `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` — Google OAuth. Local: here;
  hosted: Supabase dashboard (Auth → Providers → Google) + Vercel env.
- `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV`.
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `NEXT_PUBLIC_VERCEL_ANALYTICS_ID`.

---

## 4. Data model

All tables in `public`, RLS-enabled, deny-by-default. Profiles + bottles + quotas
are migration 001 (evolved through 024); mood/streak are migration 025.

**`profiles`** — one row per `auth.users` id (auto-created by `handle_new_user()`,
`ON CONFLICT DO NOTHING`).
- `id UUID PK → auth.users(id) ON DELETE CASCADE`
- `timezone TEXT DEFAULT 'UTC'` — IANA tz; drives the per-user local day (§5).
- `email_notifications BOOLEAN NOT NULL DEFAULT TRUE` (mig 018) — opt-out honoured by `notify-receiver`.
- `created_at TIMESTAMPTZ DEFAULT now()`, `last_active TIMESTAMPTZ` (stamped on send / check-in).
- (Legacy `whatsapp_*` columns retained but unused — WhatsApp was removed; never write them.)

**`bottles`** — the message container.
- `id UUID PK DEFAULT gen_random_uuid()`
- `sender_id UUID → profiles(id)`, `receiver_id UUID → profiles(id)` (no ON DELETE action — see account delete, §7)
- `message TEXT NOT NULL CHECK (char_length BETWEEN 1 AND 1000)`
- `sent_at TIMESTAMPTZ DEFAULT now()`, `received_at TIMESTAMPTZ` (NULL = adrift; set = matched/found-time)
- `read_at`, `is_read BOOL`, `is_reported BOOL`, `is_stale BOOL`
- `email_notified_at TIMESTAMPTZ` (mig 010) — idempotency claim for the email send.
- `delivered_ack_at TIMESTAMPTZ` (mig 016) — sender dismissed the "delivered" toast.
- `day_key DATE DEFAULT user_local_date(auth.uid())` (mig 019) — the **sender's local date**.
- `UNIQUE (sender_id, day_key)` (mig 004) — the atomic one-bottle-per-day-sent guard.
- Indexes: sender_id, receiver_id, day_key, partial `idx_bottles_unmatched`
  (`received_at IS NULL AND is_stale = FALSE`), partial `idx_bottles_adrift` (mig 021).

**`daily_quotas`** — quota ledger, PK `(user_id, date)`.
- `date DATE` = the **owner's local date**. `has_sent BOOL`, `has_received BOOL`.
- "Reset" is implicit: a new local day → a new row → fresh quota. No reset job.
- Sender rows keyed to the sender's local day; receiver rows (written by
  `match_bottle`) to the *receiver's* local day. They can differ — a bottle thrown on
  the sender's Tuesday may be received on the receiver's Wednesday. That is correct.

**`public_stats`** (mig 021) — single-row (`id BOOLEAN PK DEFAULT TRUE`, singleton
check) cache for landing counters. RLS-enabled, **no policies** → only SECURITY
DEFINER functions touch it. `adrift_count`, `total_count`, `updated_at`.

**`mood_check_ins`** (mig 025) — one mood per user per local day. PK
`(user_id, local_date)`. `mood TEXT CHECK IN ('stormy','foggy','calm','sunny')`.
Re-checking the same day UPDATEs the mood without re-advancing the streak. RLS:
owner-SELECT only; writes via RPC only.

**`user_streaks`** (mig 025) — materialised per-user streak, PK `user_id`.
`current_streak`, `longest_streak`, `last_check_in_date`, `grace_used`,
`grace_month`, `updated_at`. RLS: owner-SELECT only; advanced only by `check_in_mood()`.

---

## 5. The working mechanism (end-to-end)

### User journey
1. **Sign in** (Google OAuth or email+password) → `/auth/callback` exchanges the PKCE
   code / verifies the email OTP → session cookie → `/home`.
2. On **home**, a bottle is tethered beneath a compose box, bobbing on the sea. The
   user writes one message and throws it.
3. The throw calls `send_bottle()` RPC (one atomic Supabase round trip). The bottle
   drops into the sea and **drifts** — counted in "bottles adrift right now" on landing.
4. **It cannot be found for at least one hour.** No instant match exists.
5. After ~1h, the matcher assigns the bottle to a random **eligible** stranger
   (someone who hasn't received a bottle on *their* local day). At that moment: the
   receiver gets a branded email (Resend) + an in-app notification; the sender's
   bottle vanishes from their sea and they get a quiet "delivered" signal; the message
   lands in the receiver's **Inbox**.
6. Tomorrow (at *the user's* local midnight), the daily bottle refills.

Exactly **one throw per day**, at most **one receive per day**, measured per user's
local timezone.

### The matcher — one atomic chokepoint
`public.match_bottle(p_bottle_id UUID)` (mig 017, hardened in 022) is the single
transactional matcher. Both the `match-bottle` Edge Function and the `pg_cron` retry
path call it, so the two can never diverge. In one transaction it:
1. `SELECT … FOR UPDATE` locks the bottle row (concurrent callers serialize).
2. Returns `{matched:true, reason:'already matched'}` if `received_at` is already set
   (idempotent; never burns quota — fixes the lost-race quota burn).
3. **Enforces the 1-hour rule**: if `sent_at > now() - interval '1 hour'`, returns
   `{matched:false, queued:true, reason:'too early'}` and leaves it adrift.
4. Picks a random eligible receiver: `p.id <> sender_id` AND a `NOT EXISTS` correlated
   subquery against `daily_quotas` for that receiver's *own* local day
   (`user_local_date(p.id)`), `ORDER BY random() LIMIT 1`. `NOT EXISTS` (not an `IN`
   list) keeps query size O(1) under load.
5. Returns `{matched:false, queued:true, reason:'no eligible receiver'}` if none.
6. Otherwise sets `receiver_id` + `received_at = now()` and upserts the receiver's
   `daily_quotas` row (`has_received = TRUE`), keyed to the receiver's local day —
   same transaction (both commit or neither).
7. Returns `{matched:true, receiver_id, bottle_id}` only on a *fresh* match; callers
   fire the email only when `receiver_id` is present.

`match_bottle` is GRANTed to `service_role` only (revoked from public/anon/authenticated).

### Driving the matcher: pg_cron
`retry_unmatched_bottles()` (mig 006 → rewritten through 019) iterates all unmatched,
non-stale bottles in `random()` order, delegates each to `match_bottle()`, and for
each fresh match fires `notify-receiver` via `pg_net` (`net.http_post`, service-role
key read from `app.settings.service_role_key`). Scheduled **every 15 minutes**
(`*/15 * * * *`, mig 020). A bottle is found on the first tick after it crosses one
hour → ~1h00–1h15 after the throw.

### Per-user local day helpers (mig 017)
- `user_local_date(p_user UUID)` — `(now() AT TIME ZONE COALESCE(profiles.timezone,'UTC'))::date`. SECURITY INVOKER.
- `user_local_today()` — `user_local_date(auth.uid())`, for the caller.
The browser persists its IANA tz to `profiles.timezone` via `PATCH /api/profile`
(AuthProvider, only when changed), validated against `^[A-Za-z_/+\-]{1,64}$`.

### Stale cleanup (mig 012)
The midnight `daily-bottle-stale-cleanup` cron only marks **delivered** bottles
(`received_at IS NOT NULL`) stale after 30 days (inbox cleanup). Unmatched bottles
**persist indefinitely** until matched — never auto-staled.

### Live public counters (event-driven, mig 023 — replaced the mig 021 crons)
Landing reads one cached `public_stats` row via `get_public_stats()` (granted to
`anon`). Triggers keep it live, O(1) per event, no `COUNT(*)` per visitor:
- `total_count` — `+1` AFTER INSERT (`bump_total_count`), never decremented → monotonic.
- `adrift_count` — `adjust_adrift_count` AFTER INSERT/UPDATE/DELETE applies the exact
  membership delta over `received_at IS NULL AND is_stale = FALSE`: throw +1, match −1,
  go-stale −1, un-stale +1, delete-while-adrift −1. No drift, no reconcile cron.

### Realtime: broadcast, with a poll safety net (mig 015)
A DB trigger `notify_bottle_matched()` fires on the `received_at` NULL→non-NULL
transition and sends two **private** Realtime broadcasts carrying only `{bottle_id}`:
`bottle_received` to `user:<receiver_id>`, `bottle_delivered` to `user:<sender_id>`.
`realtime.messages` RLS restricts each client to its own `user:<auth.uid()>` topic.
`RealtimeBottleListener` (mounted once in the app layout) subscribes and **only
invalidates RTK Query cache tags** on receipt — it owns no user-facing state. Every
banner derives from server truth and also reconciles via a slow focused-tab poll
(≤30s) or navigation, so a missed socket event delays a notification but never loses one.

### Mood check-in + ADHD-safe streak (mig 025 — Phase 1 retention spine)
A lower-bar daily ritual than the throw: one tap on a weather metaphor
(stormy/foggy/calm/sunny) that seeds the bottle flow and anchors a streak.
- `check_in_mood(p_mood TEXT) → JSONB` — atomic: upserts today's mood (keyed to the
  user's local day) and advances the streak. Re-checking the same day only updates the
  mood (`advanced:false`), it does not re-advance. The streak **forgives** up to
  **2 missed days per calendar month** (`GRACE_PER_MONTH`): a gap absorbs grace budget
  and holds the streak; exceeding it resets to 1. No shame state is stored — the
  streak only advances or resets. Stamps `last_active`.
- `get_mood_streak_status() → JSONB` — `{today_mood, checked_in_today, current_streak,
  longest_streak, at_risk}`. `at_risk` = live streak AND not yet checked in today
  (drives a gentle nudge, never a punishing countdown).
Both granted to `authenticated` only.

---

## 6. Backend RPCs & functions (complete reference)

All RPCs are `SECURITY DEFINER`, pin `search_path = public, pg_temp`, and scope by
`auth.uid()` unless noted. A NULL uid matches no rows / raises `42501`.

**Client-callable (granted to `authenticated`):**
- `send_bottle(p_message TEXT) → JSONB` (mig 024) — **the throw**. Validates
  (non-empty, ≤1000), quota-checks, inserts the bottle (`day_key` default = sender
  local date), upserts `daily_quotas.has_sent`, stamps `last_active`, all in one
  transaction. Returns the new bottle **without `sender_id`**. `UNIQUE(sender_id,
  day_key)` is the authoritative double-send guard (`23505` → client maps to "already
  sent today"). Does **not** trigger matching (1-hour rule).
- `get_today_bottle_status() → JSONB` (mig 014 → 016 → 019) — home state, caller's
  local date. Returns `{ quota, sentBottle, receivedBottle, sailingBottles[≤21],
  unackedDelivered[] }`. Identity columns omitted. `unackedDelivered` is intentionally
  **not** filtered by `day_key` (a bottle thrown days ago and matched today must still
  surface the toast — do not "fix" this).
- `get_received_bottles() → TABLE` (mig 014) — inbox + unread badge; `receiver_id =
  auth.uid()`, non-stale, `received_at DESC`. Safe columns only.
- `get_todays_bottle_count() → INTEGER` (mig 014) — global ambient count for today
  (UTC day; bare integer; requires a logged-in caller).
- `ack_delivered_bottles() → VOID` (mig 016) — sets `delivered_ack_at = now()` on all
  the caller's unacked delivered bottles.
- `check_in_mood(p_mood TEXT) → JSONB`, `get_mood_streak_status() → JSONB` (mig 025) — see §5.
- `get_public_stats() → TABLE(adrift_count, total_count, updated_at)` (mig 021) —
  granted to **anon + authenticated**; reads the one cached row.
- `user_local_today() → DATE`, `user_local_date(UUID) → DATE` (mig 017).

**Service-role / internal only (revoked from clients):**
- `match_bottle(p_bottle_id UUID) → JSONB` (mig 017/022) — granted to `service_role` only.
- `retry_unmatched_bottles() → INTEGER` (mig 006…019) — pg_cron; EXECUTE revoked from PUBLIC/authenticated (mig 009).
- `bump_total_count` / `adjust_adrift_count` / `notify_bottle_matched` /
  `handle_new_user` — trigger functions, no client grants.

### Edge Functions (Deno, `supabase/functions/`)
Both require the service-role key in the `Authorization: Bearer` header (checked
against `SUPABASE_SERVICE_ROLE_KEY`); both reject non-POST.

- **`match-bottle`** — thin wrapper. Validates caller, parses `{bottle_id}`, calls the
  `match_bottle` RPC, and on a *fresh* match (`result.receiver_id` present)
  fire-and-forget invokes `notify-receiver`. All matching logic lives in the RPC.
  (With the 1-hour rule + throw via RPC, the steady-state matcher is the pg_cron retry
  path; this function is the service-role entry point.)
- **`notify-receiver`** — sends the branded "A bottle washed up 🫙" email via the
  Resend HTTP API. Idempotency = **claim-before-send**: stamp `email_notified_at` with
  an `IS NULL` guard, read back the row; exactly one caller wins, concurrent callers
  bail. Honours `profiles.email_notifications` (skips opted-out receivers without
  stamping, so re-enabling lets the retry reach them), reads the receiver's email via
  `auth.admin.getUserById` (never logged), and on Resend failure **releases** the claim
  (guarded to its own timestamp) so the retry cron can re-attempt. Prefers a missed
  email over a duplicate.

### Migration ledger (one-liners)
`001` schema+`handle_new_user` · `002` RLS · `003` pg_cron+pg_net, stale cron · `004`
`UNIQUE(sender_id,day_key)` · `005` column-level UPDATE lockdown (receiver →
`is_read,read_at,is_reported` only) · `006` retry matcher + hourly cron · `007` retry
v2 · `008` REPLICA IDENTITY FULL (later reverted) · `009` revoke public EXECUTE on
retry · `010` `email_notified_at` · `011` retry fires notify via pg_net · `012`
unmatched persist; stale cron → 30-day delivered cleanup · `013` random delivery order
· `014` client-read RPCs (status/received/count) · `015` anonymity: broadcast Realtime
+ column-level SELECT lockdown of `sender_id`/`receiver_id`, drop postgres_changes,
revert REPLICA IDENTITY · `016` `delivered_ack_at` + `ack_delivered_bottles` +
`unackedDelivered` · `017` atomic `match_bottle` + local-day helpers · `018`
`email_notifications` pref · `019` per-user local-midnight day model; retry delegates
to `match_bottle` · `020` retry cron → every 15 min · `021` `public_stats` + cron
refreshers · `022` **1-hour-adrift rule** in `match_bottle` · `023` event-driven
counters (triggers replace 021 crons) · `024` `send_bottle` RPC (throw off Vercel) ·
`025` mood check-in + ADHD-safe streak (`mood_check_ins`, `user_streaks`,
`check_in_mood`, `get_mood_streak_status`).

---

## 7. Remaining Vercel API routes (`apps/web/app/api/`)

Reads, the throw, and the mood check-in moved to Supabase RPCs; what's left needs the
service role, server secrets, or session-cookie identity:

- `PATCH /api/bottles/[id]/read` — mark received bottle read (idempotent, RLS-scoped;
  UUID-validated; no `.eq('receiver_id')` because that column isn't SELECT-granted —
  the RLS policy expression is authoritative).
- `POST /api/bottles/[id]/report` — flag bottle reported (idempotent, RLS-scoped).
- `GET|PATCH /api/profile` — read/update own profile (timezone + email_notifications);
  validates tz format; stamps `last_active`.
- `POST /api/account/delete` — hard-delete the **session** user (never a body value).
  Manual cascade (service role): delete `daily_quotas`, then `bottles` where
  sender_or_receiver, then `auth.admin.deleteUser` (cascades the profile). FKs to
  `profiles` have no ON DELETE action, so children must go first. (Mood/streak rows
  CASCADE from profiles automatically.)
- `POST /api/whatsapp/register` — **deprecated**, returns `410 Gone`.
- `GET /api/health` — `runtime = 'edge'`, returns `{status:'ok'}`.
- `GET /auth/callback` — PKCE `exchangeCodeForSession` **or** email OTP `verifyOtp`
  (whitelisted types); same-origin `next` validation (open-redirect guard); errors
  redirect to `/sign-in?error=missing_code|auth_failed`, never a 500 with details.

### Auth / middleware
`middleware.ts` matches `/home|/inbox|/settings(/*)`, `/api/*`, `/sign-in`, `/sign-up`
(NOT `/auth/callback` — must be reachable unauthenticated). For `/api/*` it does a
**cheap cookie-presence** check only (each route runs its own `getUser()`; doing it
twice billed two Auth round-trips). For app/auth routes it calls
`supabase.auth.getClaims()` — **local JWT verification** against cached JWKS (no
Auth-server round-trip on steady state; kills the tab-switch lag / skeleton flash),
still rotating an about-to-expire session via `setAll`. Unauth on an app route →
`/sign-in`; authed on `/sign-in|/sign-up` → `/home`.

Supabase clients: `lib/supabase/client.ts` (browser, `createBrowserClient`),
`server.ts` (SSR, cookie-bridged), `service.ts` (`createServiceClient`, service role,
no session persistence — **server-only**).

---

## 8. Frontend

### Providers & shell
`app/layout.tsx` wires fonts (Playfair Display = `--font-display`, DM Sans =
`--font-ui`, JetBrains Mono = `--font-mono`), `ReduxProvider` → `AuthProvider`, plus
Vercel `Analytics` + `SpeedInsights`. Viewport is mobile-first (`viewportFit:'cover'`,
themeColor `#0A1628`, `interactiveWidget:'resizes-content'`). `manifest.ts` makes it an
installable standalone PWA.

`AuthProvider` bootstraps Redux from the Supabase session: `getSession()` (sync cookie
restore) seeds a minimal user immediately so the home status RPC fires in parallel with
`/api/profile` (not serially), then `fetchProfile()` enriches it and `syncTimezone()`
persists the browser tz if changed. Subscribes to `onAuthStateChange`
(SIGNED_IN/OUT/TOKEN_REFRESHED).

`(app)/layout.tsx` → `AppShell` (100svh, no page scroll; `WaveBackground`, `BottomNav`)
and mounts client-only `RealtimeBottleListener`, `ReceivedBanner`, `DeliveredBanner`.
`BottomNav` shows an inbox unread badge fed by `getReceivedBottles` (5-min
Supabase-direct poll, `skipPollingIfUnfocused`).

### Redux store (`store/`)
`configureStore` with reducers `auth`, `bottle`, `ui`, + `bottleApi` & `authApi`.
`setupListeners(store.dispatch)` wires focus/online so `skipPollingIfUnfocused` actually
skips (the throttle the no-Vercel-polling rule depends on).
- `authSlice` — `user: Profile | null`, `isLoading`, `isOnboarded`.
- `bottleSlice` — `sendStatus` (`idle|composing|throwing|thrown`), `receiveStatus`,
  `isAnimating`, `message`.
- `uiSlice` — report modal state; `receivedBannerDismissedIds` (a **set/array** so
  dismissing one unread bottle still surfaces the next — bug 7).

### RTK Query (`store/api/`)
`bottleApi` (`tagTypes: BottleStatus, ReceivedBottles, BottleCount, MoodStreak`).
Reads / throw / mood use `queryFn` → `supabase.rpc(...)` directly (zero Vercel compute):
`getTodayBottleStatus`, `sendBottle` (optimistic `quota.has_sent = true`, undo on
failure; surfaces SQLSTATE so the UI distinguishes `23505` "already sent"),
`getReceivedBottles`, `ackDeliveredBottles`, `getBottleCount`, `getPublicStats`,
`getMoodStreak`, `checkInMood` (optimistic today_mood + checked_in_today, undo on
failure). Mutations that still hit Vercel routes: `markBottleRead` (PATCH),
`reportBottle` (POST). `authApi` (`getProfile`, `updateProfile`) uses
`fetchBaseQuery('/api')`.

### Home interaction (`app/(app)/home/page.tsx`)
One continuous sea spans the whole flow. Throw → `setSendStatus('throwing')` →
`sendBottle().unwrap()`; on drop-complete, if not failed, → `'thrown'` and arm
`justThrew`. `buildSeaBottles()` (`seaBottles.ts`) inserts ONE optimistic placeholder
only while `justThrew` bridges the throw→refetch gap (gated so a reloaded
already-delivered bottle never spawns a phantom). The 30s Supabase-direct status poll +
Realtime invalidation drop a matched bottle out of the sea and flip idle/sailing
automatically. Sea ceiling = 21 sailing bottles ("Your sea is full"). Bottle
components: `SailingSea`, `TetheredBottle`, `BottleCanvas`, `MessageEditor`,
`ThrowAnimation`, `ReceivedBottle`; mood: `MoodCheckIn`, `StreakBadge`; shared:
`WaveBackground`, `NightSky`, `OceanCounter`, `DailyTimer`, banners, `BottleSkeleton`.

### Design tokens (`tailwind.config.ts` — canonical; read the file's header comment)
Colors: `ocean-deep #0A1628` (page bg), `ocean-mid #0D2137` (surface), `seafoam
#4ECDC4` (accent), `sand #F7E7CE` (text), `coral #FF6B6B` (throw CTA + destructive
ONLY), `glass`/`foam` (frosted surfaces), plus semantic aliases (`surface-0/1`,
`text-primary/secondary/tertiary`, `border-subtle/active`). Radii: `card` 24px,
`button` 16px, `chip` 12px, `input` 24px. Motion: `throw-arc`
cubic-bezier(.25,.46,.45,.94), `bottle-bob` 3.2s, `shimmer`, `skeleton-pulse`,
`reveal-up`, `scale-in`; Framer spring tokens documented in the config header. Spacing
is a 4px grid. Fonts: display = bottle content/headings, ui = chrome, mono =
timestamps/counts/codes.

---

## 9. Anonymity model (defense in depth)

- **Column-level SELECT ACL** (mig 015): `authenticated`/`anon` cannot SELECT
  `sender_id`/`receiver_id` at all. RLS policy *expressions* are exempt, so policies
  still reference them — but a client `.select()` or `.eq()` on those columns fails.
- **Column-level UPDATE ACL** (mig 005): receivers may only write
  `is_read,read_at,is_reported`; everything else is service-role-only.
- **SECURITY DEFINER read RPCs** return safe columns only — identities never leave the DB.
- **Realtime** payloads carry only `{bottle_id}`; `realtime.messages` RLS scopes each
  client to its own `user:<uuid>` topic.
- **RLS** scopes every row to its sender or receiver; `match_bottle`/quota writes are
  service-role / SECURITY DEFINER only.
- **Service-role key** is server-only.

---

## 10. Roadmap & status (Phase 1 — retention)

The product spec's Phase 1 retention spine is in flight. **Shipped:** daily mood
check-in + ADHD-safe streak (mig 025; `apps/web/components/mood/`, `getMoodStreak` /
`checkInMood`). **Still to build:** push notifications, a private "save shelf" (keep a
received bottle), and a reply-thread mechanic. Build in small reviewable increments.
See `docs/PRODUCT_SPEC.md`.

---

## 11. Agents & conventions

Specialized subagents exist for this repo (`.claude/agents/`): **bella** (frontend),
**felix** (backend/Supabase/RLS/Edge Functions), **cherry** (UI/UX), **khasi**
(review), **shiv** (DevOps), **nagoya** (PM), **kitty** (docs/changelog). ESLint
enforces: no `console` except warn/error, no `any`, no unused (except `_` args), and
the `pollingInterval` restriction (§1.1). `CHANGELOG.md` follows Keep a Changelog.
Migrations are append-only and numbered — never edit an applied migration; add a new one.
