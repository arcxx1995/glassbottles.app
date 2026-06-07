# AGENT_LOG_FELIX.md — Backend Engineer

> Felix's decisions on schema, API routes, and edge functions.

## Initialization
**Agent**: Felix  
**Role**: Backend Engineer  
**First Task**: Supabase schema migrations, RLS policies, auth middleware

### Migration Status
| Migration | File | Status |
|---|---|---|
| Init schema | 001_init_schema.sql | ✅ Done |
| RLS policies | 002_rls_policies.sql | ✅ Done |
| Cron jobs | 003_cron_jobs.sql | ✅ Done |
| Bottle send uniqueness | 004_bottle_send_uniqueness.sql | ✅ Done |
| RLS column restriction | 005_rls_column_restriction.sql | ✅ Done |
| Hourly retry cron      | 006_match_retry_cron.sql       | ✅ Done |

### API Route Status
| Route | Method | File | Status |
|---|---|---|---|
| /api/bottles/send | POST | app/api/bottles/send/route.ts | ✅ Done |
| /api/bottles/status | GET | app/api/bottles/status/route.ts | ✅ Done |
| /api/bottles/received | GET | app/api/bottles/received/route.ts | ✅ Done |
| /api/bottles/[id]/read | PATCH | app/api/bottles/[id]/read/route.ts | ✅ Done |
| /api/bottles/[id]/report | POST | app/api/bottles/[id]/report/route.ts | ✅ Done |
| /api/profile | GET + PATCH | app/api/profile/route.ts | ✅ Done |
| /api/whatsapp/register | POST | app/api/whatsapp/register/route.ts | ✅ Done |

### Lib Status
| Module | File | Status |
|---|---|---|
| Supabase server client | lib/supabase/server.ts | ✅ Done |
| Supabase browser client | lib/supabase/client.ts | ✅ Done |
| Supabase service role client | lib/supabase/service.ts | ✅ Done |
| WhatsApp Cloud API client | lib/whatsapp/client.ts | ✅ Done |

---
<!-- Felix appends sessions below this line -->

## 2026-06-07 Session 1
**Agent**: Felix
**Task**: Build all API routes, lib clients, and fix race condition in quota enforcement
**Files Changed**:
- `supabase/migrations/004_bottle_send_uniqueness.sql` (NEW)
- `apps/web/lib/supabase/service.ts` (NEW)
- `apps/web/lib/whatsapp/client.ts` (NEW)
- `apps/web/app/api/bottles/send/route.ts` (NEW)
- `apps/web/app/api/bottles/status/route.ts` (NEW)
- `apps/web/app/api/bottles/received/route.ts` (NEW)
- `apps/web/app/api/bottles/[id]/read/route.ts` (NEW)
- `apps/web/app/api/bottles/[id]/report/route.ts` (NEW)
- `apps/web/app/api/profile/route.ts` (NEW)
- `apps/web/app/api/whatsapp/register/route.ts` (NEW)

**Decisions Made**:
- User identity always from session cookie — query param `userId` ignored on all routes (never trust client for auth)
- `sender_id` never selected in received bottle queries — enforced at SELECT level, not just RLS
- `receiver_id` never selected in sent bottle queries — sender learns if matched (received_at ≠ null) but not who received it
- `whatsapp_number` returned to profile owner only (for settings UX). Never logged. RLS isolates users. **Security trade-off noted** — MASTER_PROMPT says "never in client state" but settings page (Bella) requires it; compromise is to return it only to owner, never to other users.
- WhatsApp number validated E.164 before save on both `/api/profile` PATCH and `/api/whatsapp/register`
- `whatsapp_verified = true` set immediately on save (v1 simplified — no OTP yet). Flag for v2: proper OTP flow via WhatsApp API before marking verified.
- Service role client (lib/supabase/service.ts) used only for: daily_quotas upsert (no client INSERT policy), match-bottle edge function invocation
- match-bottle invoked fire-and-forget (catch swallowed) — pg_cron picks up stragglers
- WhatsApp retry: 1 attempt + 1 retry after 1s delay (matches edge function behavior)
- Error logs never include WhatsApp numbers or user PII

**Security Concerns Flagged**:
1. **RACE CONDITION (FIXED)**: RLS INSERT quota check on `daily_quotas` was not atomic with bottle INSERT. Fixed via migration 004: `UNIQUE (sender_id, day_key)` constraint on bottles table. Now any duplicate INSERT fails at DB level with unique violation.
2. **whatsapp_number in client state**: Settings page shows number in input. Accepted trade-off — owner viewing own data. Added note for v2 to mask with `•••• ••••1234` display.
3. **RLS on `bottles` UPDATE policy**: Current policy allows receiver to update ANY column (not just is_read/is_reported). Should be tightened with column-level restrictions or a separate policy per column. Flag for Khasi review.

**Open Questions**:
- Should `PATCH /api/profile` and `POST /api/whatsapp/register` be merged or kept separate? Currently both save the number. Kept separate for clean separation of concerns (profile = general settings, register = explicit WhatsApp opt-in flow).
- `GET /api/bottles/status` ignores `userId` query param — RTK Query passes it but we derive from session. Should RTK Query be updated to not pass the param? Low priority.

**HANDOFF → KHASI**: Review RLS UPDATE policy on `bottles` table — policy allows receiver to update all columns. Should restrict to only `is_read`, `is_reported`, `read_at`. Also review migration 004 for correctness.

---

## 2026-06-07 Session 2
**Agent**: Felix
**Task**: Install Supabase CLI + init local config
**Files Changed**:
- `supabase/config.toml` (NEW — via `supabase init`, moved from nested dir)
- `supabase/.gitignore` (NEW — auto-generated by CLI)

**Decisions Made**:
- Supabase CLI v2.105.0 installed via `brew install supabase/tap/supabase`
- `supabase init` run from project root — config lands at `supabase/config.toml`
- `project_id` corrected from `"supabase"` (default) to `"glassbottles"`
- `auth.site_url` left as `http://127.0.0.1:3000` (local dev default — must set to `https://glassbottles.app` for prod via Supabase dashboard, not committed here)
- Local stack requires Docker — Docker not running is expected in current env; CLI itself is functional
- `supabase db push` / `supabase db reset` will apply migrations in order (001→004) when Docker is available or pointed at remote via `--linked`

**Open Questions**:
- Link to remote Supabase project: run `supabase login` + `supabase link --project-ref <ref>` when credentials available
- Docker Desktop needed for `supabase start` (local dev stack)

**HANDOFF → SHIV**: Add `supabase login` + `supabase link` steps to dev setup docs. Ensure `SUPABASE_ACCESS_TOKEN` available in CI for `supabase db push --linked` in deploy pipeline.

---

## 2026-06-07 Session 3
**Agent**: Felix
**Task**: Security fixes across edge functions + tighten RLS column restriction + add hourly retry cron

**Files Changed**:
- `supabase/functions/match-bottle/index.ts` (FIXED — SQL injection + receiver_id omission in send-whatsapp payload)
- `supabase/functions/send-whatsapp/index.ts` (FIXED — receiver_id now saved in whatsapp_logs)
- `supabase/migrations/005_rls_column_restriction.sql` (NEW)
- `supabase/migrations/006_match_retry_cron.sql` (NEW)

**Decisions Made**:
- **SQL injection fix (match-bottle)**: Replaced template-literal subquery `'${bottle.day_key}'` with a two-step query: (1) fetch `daily_quotas` rows via parameterised `.eq()` filters, (2) build UUID exclusion list for `.not('id','in',...)`. UUIDs are `[0-9a-f-]` only — no injection surface even in this form.
- **receiver_id in whatsapp_logs**: `match-bottle` now passes `receiver_id` in the `send-whatsapp` invocation body. `send-whatsapp` saves it to `whatsapp_logs.receiver_id` (previously always NULL). Schema FK enforced.
- **receiver_id not returned to caller**: `match-bottle` response is `{ matched: true }` — receiver identity never leaks to the caller (sender).
- **Column-level RLS (migration 005)**: `REVOKE UPDATE ON bottles FROM authenticated` then `GRANT UPDATE (is_read, read_at, is_reported) ON bottles TO authenticated`. Two-layer defence: column grants + row RLS policy. Service role unchanged (bypasses RLS). Closes the gap flagged in Session 1.
- **Hourly retry cron (migration 006)**: `retry_unmatched_bottles()` SQL function iterates unmatched non-stale bottles, finds eligible receivers, assigns them transactionally. Runs at `:30` past every hour (offset from midnight stale-cleanup at `:00`). Implements Nagoya spec: "No eligible receiver today → bottle is queued, matched next available day."
- **Known v1 limitation**: SQL retry path does NOT trigger WhatsApp notification (pg_cron → SQL only, no HTTP). Matched bottles from retry will show in inbox but receiver won't get WhatsApp ping. TODO v2: pg_net trigger on `bottles.received_at` going NULL → non-NULL.
- **Race window acknowledged (match-bottle)**: Two concurrent edge-function invocations can still pick the same receiver between step 2b SELECT and step 3 UPDATE. The SQL retry function closes this for its own execution (single transaction + `CONTINUE WHEN NOT FOUND` guard). Edge-function path accepted for v1 given low concurrent send volume.

**Security Concerns Addressed**:
1. ✅ **SQL injection in match-bottle** — FIXED (was flagged as high priority; template literal on `day_key` from DB row)
2. ✅ **RLS UPDATE too broad** — FIXED via migration 005 column-level grants (was flagged Session 1, HANDOFF to Khasi)
3. ✅ **whatsapp_logs.receiver_id always NULL** — FIXED (schema FK was present but never populated)

**Open Questions**:
- v2: Add pg_net HTTP call inside `retry_unmatched_bottles()` to trigger `send-whatsapp` for retry-matched bottles
- v2: Proper OTP flow for WhatsApp verification (currently `whatsapp_verified = true` set immediately)

**HANDOFF → KHASI**: Review migration 005 — verify `REVOKE UPDATE` + column-level `GRANT` is correct for Supabase's permission model. Specifically: confirm `authenticated` role is the right grant target (not `anon` or `public`). Also review migration 006 SQL function for correctness under concurrent load.

---

## 2026-06-07 Session 4
**Agent**: Felix
**Task**: XSS fixes in agent dashboard (security hook findings)
**Files Changed**:
- `apps/dashboard/server.mjs` (FIXED — server-side input validation on `POST /api/tags`)
- `apps/dashboard/public/index.html` (already fixed by another agent between sessions — verified)

**Context**:
Security hook flagged 3 issues in the agent dashboard:
1. [HIGH] Stored XSS: `node.name` / `node.path` / `t.label` / `t.color` interpolated into `innerHTML` unescaped in `renderNodes()`
2. [HIGH] Stored XSS: same in `renderExistingTags()`
3. [MEDIUM] No server-side input validation on `POST /api/tags` — `color`, `tag`, `path` accepted as-is

**Findings on review**:
- Issues 1 & 2 were already fixed (by another agent mid-session): `renderNodes`, `renderExistingTags`, `renderAtDropdown` all rewritten to use `createElement`/`textContent`/`addEventListener`. Color validated against `TAG_COLORS` allowlist inline. Client-side tag label regex added to `addTag()`.
- Issue 3 (server-side validation) was still absent. Fixed in this session.

**Decisions Made**:
- `VALID_TAG_COLORS = new Set(['seafoam','coral','yellow','purple','blue','sand'])` — server-side allowlist, must stay in sync with `TAG_COLORS` in index.html
- `TAG_LABEL_RE = /^[\w .\-]{1,40}$/` — matches client-side regex exactly (defence-in-depth)
- `path` capped at 500 chars — prevents oversized JSON keys in tags.json
- `color` rejected if not in allowlist — even though HTML is now DOM-constructed, server must not persist arbitrary class names (future-proofing)

**Security Note**:
Dashboard is localhost-only (`app.listen(PORT, '127.0.0.1')`). CSRF already blocked via `requireLocalOrigin`. These fixes add defence-in-depth: even if a malicious filename lands on disk (e.g., compromised npm package writes `<img onerror=...>` as filename), DOM construction prevents it rendering as HTML. Server validation prevents it being stored as a tag label.

**HANDOFF → KHASI**: Verify server.mjs `requireLocalOrigin` middleware covers all mutation endpoints. Confirm `DELETE /api/tags` also needs the same tag/path validation (currently only checks presence, not charset/length).

---

## 2026-06-07 Session 5
**Agent**: Felix
**Task**: Close v1 known limitation — pg_net WhatsApp notification for SQL-retry-matched bottles + reduce phone number surface in match-bottle

**Files Changed**:
- `supabase/migrations/007_pg_net_notify.sql` (NEW)
- `supabase/functions/match-bottle/index.ts` (UPDATED — removed whatsapp_number from SELECT + invocation body)

**Decisions Made**:
- **Migration 007**: `retry_unmatched_bottles()` recreated with `net.http_post()` call after each successful match. pg_net call is best-effort — match already committed before HTTP fires, so WhatsApp failure cannot un-match a bottle.
- **Config via DB GUC**: `app.supabase_url` + `app.service_role_key` read via `current_setting(..., true)` (NULL-safe). Settings set out-of-band (Supabase Dashboard / `ALTER DATABASE`) — never committed to migration files. Silently skips notification if settings absent (local dev safety).
- **match-bottle cleanup**: `whatsapp_number` removed from `profiles` SELECT and from `send-whatsapp` invocation body. `send-whatsapp` always looks up the number server-side from DB — caller-supplied numbers are never trusted. Reduces phone number exposure in edge function memory.
- **`send-whatsapp` body now**: `{ bottle_id, receiver_id }` only — cleaner contract, consistent with pg_net call in 007.

**Security Concerns**:
- Service role key stored as DB GUC (`pg_settings`) — visible to superusers. Acceptable on Supabase managed infra. Alternative: Vault. Documented in migration comment.
- pg_net fires with service role auth; `send-whatsapp` validates `bottle.receiver_id === receiver_id` (403 on mismatch) — no misdirected notification possible.

**Resolved v1 Limitations**:
1. ✅ SQL retry path now fires WhatsApp notifications (was flagged Session 3 as "known v1 limitation")
2. ✅ Phone number no longer in match-bottle edge function memory

**Open Questions**:
- v2: Supabase Vault (`vault.decrypted_secrets`) instead of GUC for service role key storage
- v2: WhatsApp OTP verification flow before setting `whatsapp_verified = true`
- v2: Mask phone number in settings UI (`•••• ••••1234`)

**HANDOFF → KHASI**: Review migration 007 — confirm `net.http_post()` signature matches pg_net version in project. Confirm `current_setting('app.service_role_key', true)` is not readable by `authenticated` role (should not be — GUC is session-scoped to SECURITY DEFINER function).

---

## 2026-06-07 Session 6
**Agent**: Felix
**Task**: Gap analysis across Sessions 1–5 + close critical missing backend pieces

**Gap Analysis Findings**:
1. **Missing auth bootstrap** (CRITICAL — blocked entire frontend): No component was syncing Supabase session into Redux `authSlice` on page load. Every `useAppSelector(selectUser)` returned `null`, causing all RTK Query calls with `skip: !user?.id` to never fire. Pages showed empty states even when logged in.
2. **`Bottle` type was lying** (MEDIUM): `sender_id` and `receiver_id` were typed as `string` (non-optional) but API routes deliberately omit both fields in responses. Runtime `undefined` vs type `string` — footgun for any component that tried to read those fields.
3. **Supabase Realtime broken** (HIGH): `RealtimeBottleListener` subscribes to UPDATE events filtered by `receiver_id=eq.<uuid>`. PostgreSQL default REPLICA IDENTITY only writes the PK to the WAL diff — `receiver_id` is absent in OLD row image, so the filter never matches. Migration 008 fixes this with `REPLICA IDENTITY FULL`.
4. **v2 OTP infrastructure missing** (v2 backlog): No `whatsapp_otp_pending` table, no SQL functions for OTP generation/verification, no `/api/whatsapp/verify-otp` endpoint. Built the full infrastructure now even though the feature flag defaults to off.
5. **`notificationApi` missing `verifyOtp` endpoint** (MEDIUM): Frontend settings page can't drive OTP flow without the RTK Query mutation.

**Files Changed**:
- `apps/web/types/index.ts` (UPDATED — `Bottle.sender_id` and `receiver_id` now optional with explanatory comments)
- `apps/web/components/providers/AuthProvider.tsx` (NEW — bootstraps Redux authSlice from Supabase session on mount + listens for auth state changes)
- `apps/web/app/layout.tsx` (UPDATED — wraps app with `AuthProvider` inside `ReduxProvider`)
- `apps/web/app/api/whatsapp/register/route.ts` (UPDATED — added v1/v2 mode switch via `WHATSAPP_OTP_ENABLED` env flag; v1 path unchanged; v2 path calls `generate_whatsapp_otp` SQL function)
- `apps/web/app/api/whatsapp/verify-otp/route.ts` (NEW — POST endpoint for OTP confirmation; service role + bcrypt verification via RPC; 5-attempt lockout; expiry check)
- `apps/web/store/api/notificationApi.ts` (UPDATED — added `verifyOtp` mutation endpoint; updated `RegisterWhatsAppResponse` to include `otp_required` field)
- `.env.example` (UPDATED — added `WHATSAPP_OTP_ENABLED` feature flag)
- `supabase/migrations/008_realtime_replica_identity.sql` (NEW — `REPLICA IDENTITY FULL` on bottles; adds to `supabase_realtime` publication idempotently)
- `supabase/migrations/009_whatsapp_otp.sql` (NEW — `whatsapp_otp_pending` table, RLS deny-all, pg_cron hourly cleanup of expired OTPs)
- `supabase/migrations/010_verify_whatsapp_otp_fn.sql` (NEW — `pgcrypto` extension; `generate_whatsapp_otp()` + `verify_whatsapp_otp()` SQL functions; adds `pending_number` column to OTP table)

**Decisions Made**:

- **AuthProvider over server-side hydration**: Used a client-side `useEffect` in `AuthProvider` instead of injecting user from a server component. Rationale: Next.js 14 App Router server components cannot dispatch to Redux (Redux is client-side state). The standard pattern is client-side hydration from Supabase's `onAuthStateChange`. Protected routes are still guarded server-side by `middleware.ts` — AuthProvider is for UI state, not access control.

- **`Bottle.sender_id` / `receiver_id` made optional**: These fields are intentionally absent from all API responses (anonymity). Making them optional in the type forces any future code that reads these fields to handle the `undefined` case explicitly. The `?` marks the fields as "may not be present in this context" — correct for a type that represents both sent and received bottle shapes.

- **REPLICA IDENTITY FULL on bottles only**: Only the `bottles` table is set to FULL because only that table has filtered Realtime subscriptions in this app. `profiles`, `daily_quotas`, `whatsapp_logs` do not need it. WAL amplification is scoped.

- **OTP stored as bcrypt hash, number as plaintext in `pending_number`**: We cannot bcrypt the phone number — bcrypt is one-way and we need to retrieve the number after verification. Storing plaintext in a short-lived (10 min TTL) row with no client access (RLS deny-all) + pg_cron cleanup is the pragmatic v1.5 choice. v2 upgrade path: `pgp_sym_encrypt` using Supabase Vault key.

- **CSPRNG for OTP code**: `generate_whatsapp_otp()` uses `gen_random_bytes(4)` (pgcrypto, OS CSPRNG), not `RANDOM()` (which is not cryptographically secure). The 4-byte approach has ~0.02% bias but is acceptable for a 6-digit OTP.

- **`WHATSAPP_OTP_ENABLED=false` default**: The v2 OTP flow is infrastructure-complete but feature-flagged off. v1 behavior is unchanged. Operators flip the flag to `true` after deploying migration 009+010 and creating the OTP WhatsApp template in Meta Business.

- **WhatsApp OTP template is a placeholder**: The v2 `register` route currently reuses the `glassbottle_received` template (URL button parameter = `${appUrl}/verify?code=${otpCode}`) as an interim approach. This is ugly but functional for testing. A proper `glassbottle_otp` template with a text body variable should be created in Meta Business before enabling v2 in production.

**Security Concerns**:
1. **OTP in URL parameter (v2 interim)**: `${appUrl}/verify?code=${otpCode}` puts the OTP in the URL. URLs can be logged in browser history and server logs. This is flagged as a v2 TODO — the proper template should put the OTP in the message body as a variable, not a URL parameter.
2. **Phone number plaintext in DB (10min)**: The `pending_number` column is not encrypted. Bounded risk (TTL + no client access + cleanup cron), but noted for Vault upgrade.
3. **`AuthProvider` fetches `/api/profile` on every page load**: This is an extra HTTP round-trip but is necessary to populate the Profile shape into Redux. The RTK Query `getProfile` cache will serve subsequent calls from cache. No double-fetch in steady state.

**Open Questions**:
- v2: Replace OTP URL parameter pattern with a proper Meta WhatsApp template (`glassbottle_otp`) that uses a text body variable
- v2: `pgp_sym_encrypt` for `pending_number` via Supabase Vault
- v2: Supabase Vault for `app.service_role_key` GUC (migration 007)
- Low priority: `GET /api/bottles/status` vs `GET /api/bottles/today` naming mismatch with MASTER_PROMPT spec — not a breaking issue, RTK Query calls the correct `/status` path

**Resolved v2 Backlog Items**:
1. WhatsApp OTP verification infrastructure — BUILT (feature-flagged, deploy when ready)
2. Auth bootstrap missing — FIXED (was silently breaking the entire frontend)
3. Supabase Realtime filtering broken — FIXED (migration 008)
4. `Bottle` type safety gap — FIXED

**HANDOFF → BELLA**: `AuthProvider` is now in `app/layout.tsx` inside `ReduxProvider`. All `useAppSelector(selectUser)` calls will now work correctly after page load. The `isLoading` state in authSlice is `true` until the bootstrap completes — you may want to gate render in `AppShell` on `!isLoading` to prevent flashes. Currently the middleware guards the route but there's a brief moment before Redux hydrates.

**HANDOFF → KHASI**: Review migration 008 — confirm `REPLICA IDENTITY FULL` doesn't cause performance issues at expected bottle volume; confirm publication idempotency logic is correct for Supabase managed Postgres.

---

## 2026-06-07 Session 7
**Agent**: Felix
**Task**: Remove all WhatsApp functionality from the backend — no backwards compat, no feature flags

**Files Deleted**:
- `supabase/migrations/009_whatsapp_otp.sql`
- `supabase/migrations/010_verify_whatsapp_otp_fn.sql`
- `supabase/functions/send-whatsapp/index.ts` + parent directory
- `apps/web/app/api/whatsapp/register/route.ts` + parent directory
- `apps/web/app/api/whatsapp/verify-otp/route.ts` + parent directory
- `apps/web/app/api/whatsapp/` directory (now empty)
- `apps/web/lib/whatsapp/client.ts` + parent directory

**Files Modified**:
- `supabase/migrations/001_init_schema.sql` — removed `whatsapp_number`, `whatsapp_verified` columns from `profiles`; removed entire `whatsapp_logs` table block
- `supabase/migrations/002_rls_policies.sql` — removed `ALTER TABLE whatsapp_logs ENABLE ROW LEVEL SECURITY` and the `whatsapp_logs` section heading + comment
- `supabase/migrations/006_match_retry_cron.sql` — removed WhatsApp gap comment block at top; removed `-- prefer whatsapp_verified` comment in receiver query; changed `ORDER BY p.whatsapp_verified DESC, RANDOM()` to `ORDER BY RANDOM()`; simplified COMMENT ON FUNCTION
- `supabase/migrations/007_pg_net_notify.sql` — full rewrite: removed pg_net HTTP call, GUC vars, and all WhatsApp logic; preserves matching logic from 006; simplified COMMENT ON FUNCTION
- `supabase/functions/match-bottle/index.ts` — removed `whatsapp_verified` from `select('id')`; removed `.order('whatsapp_verified', ...)` call; removed Step 5 "Fire-and-forget WhatsApp notification" block
- `apps/web/app/api/profile/route.ts` — removed `validateE164` import; removed `whatsapp_number`/`whatsapp_verified` from GET and PATCH `select()` calls; removed WhatsApp number update block from PATCH handler; removed all WhatsApp-referencing comments; updated route comment blocks
- `supabase/seed.sql` — updated commented profiles INSERT to remove `whatsapp_number`/`whatsapp_verified` columns and test data

**Decisions Made**:
- Hard delete, no feature flags, no backwards compat stubs — codebase was pre-production
- `whatsapp_logs` table removed from schema entirely (was service-role-only anyway)
- `profiles` table now contains only `id`, `timezone`, `created_at`, `last_active` — cleaner
- `match-bottle` receiver query now randomises without any whatsapp preference ordering — fair distribution is correct default
- `007_pg_net_notify.sql` retains its filename (migration order must not be disturbed) but is now a pure SQL retry function redefine

**Verification**:
`grep -r "whatsapp|WhatsApp" ... --include="*.ts" --include="*.tsx" --include="*.sql"` returned exit 1 (zero matches) after cleanup.
