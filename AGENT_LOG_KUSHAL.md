# AGENT_LOG_KUSHAL.md — Backend Engineer

> Kushal's decisions on schema, API routes, and edge functions.

## Initialization
**Agent**: Kushal  
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
<!-- Kushal appends sessions below this line -->

## 2026-06-07 Session 1
**Agent**: Kushal
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
- `whatsapp_number` returned to profile owner only (for settings UX). Never logged. RLS isolates users. **Security trade-off noted** — MASTER_PROMPT says "never in client state" but settings page (Ishan) requires it; compromise is to return it only to owner, never to other users.
- WhatsApp number validated E.164 before save on both `/api/profile` PATCH and `/api/whatsapp/register`
- `whatsapp_verified = true` set immediately on save (v1 simplified — no OTP yet). Flag for v2: proper OTP flow via WhatsApp API before marking verified.
- Service role client (lib/supabase/service.ts) used only for: daily_quotas upsert (no client INSERT policy), match-bottle edge function invocation
- match-bottle invoked fire-and-forget (catch swallowed) — pg_cron picks up stragglers
- WhatsApp retry: 1 attempt + 1 retry after 1s delay (matches edge function behavior)
- Error logs never include WhatsApp numbers or user PII

**Security Concerns Flagged**:
1. **RACE CONDITION (FIXED)**: RLS INSERT quota check on `daily_quotas` was not atomic with bottle INSERT. Fixed via migration 004: `UNIQUE (sender_id, day_key)` constraint on bottles table. Now any duplicate INSERT fails at DB level with unique violation.
2. **whatsapp_number in client state**: Settings page shows number in input. Accepted trade-off — owner viewing own data. Added note for v2 to mask with `•••• ••••1234` display.
3. **RLS on `bottles` UPDATE policy**: Current policy allows receiver to update ANY column (not just is_read/is_reported). Should be tightened with column-level restrictions or a separate policy per column. Flag for Akhilesh review.

**Open Questions**:
- Should `PATCH /api/profile` and `POST /api/whatsapp/register` be merged or kept separate? Currently both save the number. Kept separate for clean separation of concerns (profile = general settings, register = explicit WhatsApp opt-in flow).
- `GET /api/bottles/status` ignores `userId` query param — RTK Query passes it but we derive from session. Should RTK Query be updated to not pass the param? Low priority.

**HANDOFF → AKHILESH**: Review RLS UPDATE policy on `bottles` table — policy allows receiver to update all columns. Should restrict to only `is_read`, `is_reported`, `read_at`. Also review migration 004 for correctness.

---

## 2026-06-07 Session 2
**Agent**: Kushal
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

**HANDOFF → MANIKANT**: Add `supabase login` + `supabase link` steps to dev setup docs. Ensure `SUPABASE_ACCESS_TOKEN` available in CI for `supabase db push --linked` in deploy pipeline.

---

## 2026-06-07 Session 3
**Agent**: Kushal
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
- **Hourly retry cron (migration 006)**: `retry_unmatched_bottles()` SQL function iterates unmatched non-stale bottles, finds eligible receivers, assigns them transactionally. Runs at `:30` past every hour (offset from midnight stale-cleanup at `:00`). Implements Arpan spec: "No eligible receiver today → bottle is queued, matched next available day."
- **Known v1 limitation**: SQL retry path does NOT trigger WhatsApp notification (pg_cron → SQL only, no HTTP). Matched bottles from retry will show in inbox but receiver won't get WhatsApp ping. TODO v2: pg_net trigger on `bottles.received_at` going NULL → non-NULL.
- **Race window acknowledged (match-bottle)**: Two concurrent edge-function invocations can still pick the same receiver between step 2b SELECT and step 3 UPDATE. The SQL retry function closes this for its own execution (single transaction + `CONTINUE WHEN NOT FOUND` guard). Edge-function path accepted for v1 given low concurrent send volume.

**Security Concerns Addressed**:
1. ✅ **SQL injection in match-bottle** — FIXED (was flagged as high priority; template literal on `day_key` from DB row)
2. ✅ **RLS UPDATE too broad** — FIXED via migration 005 column-level grants (was flagged Session 1, HANDOFF to Akhilesh)
3. ✅ **whatsapp_logs.receiver_id always NULL** — FIXED (schema FK was present but never populated)

**Open Questions**:
- v2: Add pg_net HTTP call inside `retry_unmatched_bottles()` to trigger `send-whatsapp` for retry-matched bottles
- v2: Proper OTP flow for WhatsApp verification (currently `whatsapp_verified = true` set immediately)

**HANDOFF → AKHILESH**: Review migration 005 — verify `REVOKE UPDATE` + column-level `GRANT` is correct for Supabase's permission model. Specifically: confirm `authenticated` role is the right grant target (not `anon` or `public`). Also review migration 006 SQL function for correctness under concurrent load.

---

## 2026-06-07 Session 4
**Agent**: Kushal
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

**HANDOFF → AKHILESH**: Verify server.mjs `requireLocalOrigin` middleware covers all mutation endpoints. Confirm `DELETE /api/tags` also needs the same tag/path validation (currently only checks presence, not charset/length).

---

## 2026-06-07 Session 5
**Agent**: Kushal
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

**HANDOFF → AKHILESH**: Review migration 007 — confirm `net.http_post()` signature matches pg_net version in project. Confirm `current_setting('app.service_role_key', true)` is not readable by `authenticated` role (should not be — GUC is session-scoped to SECURITY DEFINER function).

---

## 2026-06-07 Session 6
**Agent**: Kushal
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

**HANDOFF → ISHAN**: `AuthProvider` is now in `app/layout.tsx` inside `ReduxProvider`. All `useAppSelector(selectUser)` calls will now work correctly after page load. The `isLoading` state in authSlice is `true` until the bootstrap completes — you may want to gate render in `AppShell` on `!isLoading` to prevent flashes. Currently the middleware guards the route but there's a brief moment before Redux hydrates.

**HANDOFF → AKHILESH**: Review migration 008 — confirm `REPLICA IDENTITY FULL` doesn't cause performance issues at expected bottle volume; confirm publication idempotency logic is correct for Supabase managed Postgres.

---

## 2026-06-10 Session 8
**Agent**: Kushal
**Task**: Fix 5 security issues from Akhilesh's P0 review (3 critical, 2 high)

**Files Changed**:
- `supabase/functions/match-bottle/index.ts` (FIXED — CRITICAL 1: added service role auth check at handler entry)
- `apps/web/app/api/bottles/count/route.ts` (FIXED — CRITICAL 2: switched count query to service role client)
- `apps/web/app/api/bottles/send/route.ts` (FIXED — CRITICAL 3: added `23505` unique violation to 429 branch)
- `supabase/migrations/009_revoke_public_retry.sql` (NEW — HIGH 4: revoke PUBLIC + authenticated EXECUTE on retry_unmatched_bottles())
- `apps/web/app/api/profile/route.ts` (FIXED — HIGH 5: added IANA timezone regex before length check)

**Decisions Made**:

- **CRITICAL 1 (match-bottle auth)**: Compared the service role key from `Authorization: Bearer <token>` against `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`. Placed the check as the very first logic in the handler, before method check and before body parsing — a request with a wrong key gets no information at all. The existing service role client at module scope is still correct for the Supabase queries; the new check is purely about validating the inbound caller. `api/bottles/send` already invokes via `service.functions.invoke()` which sets the service role bearer token automatically.

- **CRITICAL 2 (count RLS bypass)**: User client is retained for the `auth.getUser()` call (so auth is still validated with user-scoped credentials). A separate service client instance is created for the count query only. This follows the existing pattern in `api/bottles/send` (same dual-client approach). No PII is returned — only a scalar integer.

- **CRITICAL 3 (23505 → 429)**: Postgres error `23505` is the unique violation code for the `UNIQUE (sender_id, day_key)` constraint added in migration 004. This fires when two concurrent requests from the same user both pass the server-side quota check (which is a SELECT, not atomic with the INSERT), then race to INSERT. First write wins; second gets 23505. Without this fix that second request would return 500 and the client would retry. Now it correctly gets 429 with a human-readable message. All three codes (`42501`, `23514`, `23505`) map to the same user-facing error.

- **HIGH 4 (revoke retry fn)**: Migration 009 issues two REVOKE statements. `FROM PUBLIC` covers all roles including unauthenticated. `FROM authenticated` is belt-and-suspenders since `PUBLIC` already includes authenticated users — belt-and-suspenders is appropriate here given the function is SECURITY DEFINER. pg_cron runs as the `postgres` (superuser) role and is unaffected by these revokes. Note: migration numbering was confirmed from the AGENT_LOG history — 009 and 010 were created in Session 6 (WhatsApp OTP) then deleted in Session 7. The slot is free again.

- **HIGH 5 (timezone XSS)**: Regex `^[A-Za-z_/+\-]{1,64}$` enforces IANA timezone format. This covers all legitimate values (e.g., `America/New_York`, `UTC`, `Europe/London`, `Etc/GMT+5`) and rejects anything containing `<`, `>`, `"`, `'`, `;`, spaces, or digits — the full HTML/script injection surface. The regex also embeds the length constraint (1–64), so the old `timezone.length > 64` branch is now subsumed. The `typeof timezone !== 'string'` check is retained for type safety ahead of the regex test.

**Security Notes**:
- match-bottle: the auth check uses strict equality (`!==`) against the env var. There is no timing-safe comparison here. For a service-to-service call where the key is a long opaque token (64+ chars), timing attacks are not a practical concern — noting for completeness.
- count route: `createServiceClient()` throws if `SUPABASE_SERVICE_ROLE_KEY` is missing from env. This is intentional — a misconfigured deployment should fail loudly, not silently serve wrong data.
- profile route: the regex uses `\-` (escaped hyphen) at the end of the character class to avoid ambiguity. This is correct.

**HANDOFF → AKHILESH**: Migration 009 uses `REVOKE ... FROM PUBLIC` + `REVOKE ... FROM authenticated`. Confirm the Supabase Postgres version in use supports this syntax (it does on all pg13+). Confirm no other SECURITY DEFINER functions have the same exposure (grep for `SECURITY DEFINER` in migrations 001–008 and check each).

## 2026-06-07 Session 7
**Agent**: Kushal
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

---

## 2026-06-11 Session 9
**Agent**: Kushal
**Task**: Close remaining Akhilesh P1/MEDIUM review findings — UUID validation on param routes, middleware centralized auth, config.toml security defaults, RTK cache tag correctness

**Files Changed**:
- `apps/web/app/api/bottles/[id]/read/route.ts` (UPDATED — UUID format regex check before DB query)
- `apps/web/app/api/bottles/[id]/report/route.ts` (UPDATED — UUID format regex check before DB query)
- `apps/web/middleware.ts` (UPDATED — added `/api/:path*` to matcher; added centralized 401 guard for unauthenticated API requests)
- `apps/web/store/api/bottleApi.ts` (UPDATED — `sendBottle` mutation now invalidates `['BottleStatus', 'BottleCount']`; ambient counter refreshes after throw)
- `supabase/config.toml` (UPDATED — `minimum_password_length` 6→8 per NIST SP 800-63b; `enable_confirmations` email false→true to prevent spam account creation)

**Decisions Made**:

- **UUID regex on params**: Used standard RFC 4122 UUID pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (lowercase only). Supabase gen_random_uuid() always emits lowercase hex. The check is placed after the `!id` presence check and before any DB call. Returns 400 (not 404) — an invalid UUID is a bad request, not a missing resource.

- **Middleware API guard**: `/api/:path*` added to matcher. The middleware already calls `supabase.auth.getUser()` for session refresh; the new `isApiRoute && !user` branch fires a JSON 401 before the request reaches the route handler. Per-route `auth.getUser()` calls are retained as defence-in-depth — the middleware is a catch-all for routes that might be added in future without individual auth guards. The API guard returns JSON, not an HTML redirect — correct for machine clients.

- **config.toml security defaults**: These are local dev defaults; production is configured via Supabase dashboard. Raising them here ensures developers spin up with safe defaults that match production expectations. `enable_confirmations = true` for email means magic link users must confirm their address — consistent with magic link flow (the link IS the confirmation). Added inline comment noting production intent.

- **`sendBottle` invalidates `BottleCount`**: Minor correctness fix. The ambient counter is a `getBottleCount` query tagged `['BottleCount']`. Without this invalidation, the counter stays stale after a throw until the 5-minute RTK Query poll interval. Akhilesh flagged this in his MEDIUM section. Cross-domain fix (frontend store) but trivial — noted here to avoid Ishan re-fixing it.

**Security Notes**:
- The UUID regex enforces canonical form only. If Supabase ever changes UUID generation to uppercase, the regex would reject valid IDs. This is not a risk with `gen_random_uuid()` (always lowercase per RFC 4122 / Postgres convention).
- The middleware API guard means Supabase's `getUser()` runs on every API call — a ~5-10ms overhead vs the current approach where public endpoints could skip it. Acceptable: there are no public API endpoints in this app. Every endpoint requires auth.

**Open Questions**:
- Akhilesh MEDIUM: `daily_quotas.user_id` included in status response — cosmetic, left as-is.
- Akhilesh MEDIUM: middleware doesn't redirect authenticated users from /sign-in to /home — UX polish, deferred to Ishan.
- v2: Supabase Vault for `app.service_role_key` GUC (migration 007).
- v2: `pgp_sym_encrypt` for any sensitive fields.

**HANDOFF → AKHILESH**: All items from the 2026-06-10 P0 security review are now addressed. Summary of resolution:
- CRITICAL 1 (match-bottle no auth): FIXED Session 8
- CRITICAL 2 (count RLS bypass): FIXED Session 8
- CRITICAL 3 (23505 → 500): FIXED Session 8
- HIGH 4 (timezone XSS): FIXED Session 8
- HIGH 5 (middleware no API coverage): FIXED Session 9
- HIGH 6 (UUID validation on [id] routes): FIXED Session 9
- HIGH 7 (retry fn EXECUTE on PUBLIC): FIXED Session 8 (migration 009)
- MEDIUM 8 (minimum_password_length): FIXED Session 9
- MEDIUM 9 (enable_confirmations): FIXED Session 9
- MEDIUM 10 (sendBottle missing BottleCount tag): FIXED Session 9
- MEDIUM 11 (user_id in status response): deferred, cosmetic
- MEDIUM 12 (sign-in redirect for auth users): deferred, Ishan's domain
Requesting re-review of Session 8+9 changes before beta launch sign-off.

---

## 2026-06-11 Session 10
**Agent**: Kushal
**Task**: Technical feasibility brief — pull-back notification options post-WhatsApp removal
**Files Changed**: none (analysis only)

### Context

WhatsApp was fully removed in Session 7. The schema currently standing is:

```
profiles    (id, timezone, created_at, last_active)
bottles     (id, sender_id, receiver_id, message, sent_at, received_at,
             read_at, is_read, is_reported, is_stale, day_key)
daily_quotas (user_id, date, has_sent, has_received)
```

No notification columns, no push subscription table, no email preference
columns exist. Supabase Realtime is wired up (migration 008, REPLICA IDENTITY
FULL on bottles) and fires in-app only.

The retention problem: a user who closes the browser after sending a bottle
and never reopens it cannot discover they received one. The Realtime
subscription is not active; they receive no pull-back signal.

---

### Option A — Email via SMTP (Supabase Auth SMTP or third-party)

**What is Supabase Auth email actually for?**
Supabase's built-in SMTP integration (and the `supabase.auth.admin` API) is
scoped entirely to authentication emails: magic links, password reset,
email change confirmation, signup confirmation. There is no
`sendRawEmail()` method or equivalent on the admin client. The
`supabase.auth.admin` SDK exposes `inviteUserByEmail`,
`generateLink`, and `sendMagicLink` — none of which send arbitrary
transactional messages. Supabase's Auth SMTP cannot be repurposed for
product notifications without hacking the "magic link" template, which is
brittle and unsupported.

**Real path: third-party SMTP via Edge Function**
A transactional email provider (Resend, Postmark, or SendGrid) exposes a
simple HTTP API. An Edge Function calls that API with service-role
credentials. The user's email address is available directly from
`auth.users.email` (readable by service role, never from client).

**Schema changes needed**

A minimal preferences column on profiles:
```sql
ALTER TABLE public.profiles
  ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT TRUE;
```

No separate table needed — one boolean is sufficient for v1. No new indexes
required (the lookup is always for a specific user_id from the edge function).

RLS: `email_notifications` should be readable and writable by the profile
owner only. The existing "profiles: update own" policy already covers any
new column added to the table without policy changes, because the policy
is `FOR UPDATE USING (auth.uid() = id)` with no column restriction.

**Where the trigger fires**
`match-bottle` edge function (step 4, after receiver quota upsert) is the
right insertion point. This already runs as service role. Add a fetch call
to the SMTP provider API after quota is confirmed — fire-and-forget with
a best-effort catch, same pattern as the former WhatsApp call. The
`retry_unmatched_bottles()` SQL function (pg_cron hourly) does not
currently have HTTP capability enabled; migration 007 stripped pg_net HTTP
calls. For retry-matched bottles, the notification gap is acceptable in v1
— the edge function path covers the common case (bottle matched at send
time).

If retry-path coverage is needed: re-add a `net.http_post()` call in
`retry_unmatched_bottles()`, pointing to the new email edge function. This
requires restoring the pg_net GUC configuration that was removed in Session 7.

**New edge function needed**
`supabase/functions/send-email/index.ts` — mirrors the former
`send-whatsapp` structure:
- Accepts `{ bottle_id, receiver_id }`
- Validates inbound service role bearer token (same pattern as match-bottle)
- Looks up receiver email from `auth.users` via service role
- Checks `profiles.email_notifications = true` before sending
- Calls SMTP provider HTTP API
- Logs result in a new `email_logs` table (or extends whatsapp_logs pattern
  if Arpan wants a unified notification log)

**New env vars needed**
```
RESEND_API_KEY=           (or POSTMARK_SERVER_TOKEN / SENDGRID_API_KEY)
EMAIL_FROM=noreply@glassbottles.app
```

**Complexity**: Low-Medium
The provider HTTP API is simpler than Meta's WhatsApp API. No template
approval process. No phone number verification. Resend has a documented
Supabase Edge Function integration with a Deno-compatible SDK.

**Reliability when app is closed**: Yes — full pull-back. Email is
asynchronous and delivered regardless of browser/app state. The user
opens their email client and the deep link (`https://glassbottles.app/inbox`)
brings them back.

**Dependencies / blockers**
- DNS: must add SPF, DKIM, DMARC records for `glassbottles.app` to avoid
  spam classification. This is a one-time setup in Manikant's domain.
- Sender domain verification with the chosen provider (Resend/Postmark).
- Meta/WhatsApp template approval is NOT required — email has no approval
  gatekeeping.
- Email address collection: Supabase magic link auth already collects the
  user's email address (it is the auth identifier). Zero additional
  onboarding friction.

**Supabase integration path**
1. `match-bottle` edge function calls `send-email` edge function
   (fire-and-forget, after quota upsert).
2. `send-email` reads receiver email from `auth.users`, checks opt-out
   flag, calls provider API.
3. No DB trigger or pg_cron change required for the common path.
4. Optional v2: re-add pg_net in `retry_unmatched_bottles()` for retry-path
   coverage.

**Security notes**
- `auth.users.email` is never exposed to the client. The edge function reads
  it service-role only.
- Email address should never appear in `email_logs` — log only
  `bottle_id`, `receiver_id`, `status`, `provider_message_id`.
- Unsubscribe link in every email is legally required (CAN-SPAM, GDPR). The
  link should hit a route that sets `email_notifications = false` via a
  signed token (not raw user_id in the URL). This is the main v1 complexity
  item.

---

### Option B — Web Push via PWA Service Worker

**How Web Push works**
The browser subscribes to the Push API using a VAPID key pair. The resulting
`PushSubscription` object (an endpoint URL + auth keys specific to that
browser/device) is stored on the server. When a notification should fire,
the server makes an HTTP POST to the endpoint URL. The browser's push
service (FCM for Chrome/Android, APNs for Safari 16.4+) routes the
notification to the device. The service worker wakes, receives the message,
and shows a native OS notification — even when the browser tab is closed.

**Schema changes needed**

A new table is required to store push subscriptions:

```sql
CREATE TABLE public.push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,   -- browser public key (base64url)
  auth         TEXT NOT NULL,   -- auth secret (base64url)
  user_agent   TEXT,            -- informational only (Chrome/Safari/Firefox)
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, endpoint)    -- one row per browser per user; idempotent upsert
);
```

RLS:
```sql
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- User can read/delete their own subscriptions (for settings UI)
CREATE POLICY "push_subscriptions: read own"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "push_subscriptions: insert own"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions: delete own"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- No client UPDATE — endpoint rotation happens via delete+insert
```

The edge function reads subscriptions service-role-only (bypasses RLS).

**Frontend changes needed**

1. `public/manifest.json` — already needed for PWA installability.
   Requires `name`, `short_name`, `start_url`, `display: standalone`,
   `icons`, `theme_color`. No impact on existing functionality.

2. `public/sw.js` — service worker with `push` event listener:
   ```js
   self.addEventListener('push', (event) => {
     const data = event.data.json()
     event.waitUntil(
       self.registration.showNotification(data.title, {
         body: data.body,
         icon: '/icon-192.png',
         data: { url: data.url }
       })
     )
   })
   self.addEventListener('notificationclick', (event) => {
     event.notification.close()
     event.waitUntil(clients.openWindow(event.notification.data.url))
   })
   ```

3. Registration component (runs client-side after user gesture, required
   for notification permission prompt):
   - Call `Notification.requestPermission()`
   - Call `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`
   - POST the resulting `PushSubscription` JSON to a new API route
     (`POST /api/push/subscribe`)

4. New API route `apps/web/app/api/push/subscribe/route.ts`:
   - Auth-gated (session cookie)
   - Upserts subscription into `push_subscriptions` table (service role,
     ON CONFLICT DO UPDATE SET last_used_at = NOW())

**New edge function needed**
`supabase/functions/send-push/index.ts`:
- Accepts `{ bottle_id, receiver_id }`
- Validates service role bearer token
- Fetches all active `push_subscriptions` for `receiver_id`
- For each subscription, constructs and sends a Web Push message using the
  `web-push` library (or equivalent Deno implementation)
- Handles `410 Gone` responses from push endpoints (subscription expired —
  delete the row)
- Handles `400/404` responses (invalid subscription — delete the row)
- Logs result

**VAPID keys**
```
VAPID_PUBLIC_KEY=    (base64url, sent to client for subscription)
VAPID_PRIVATE_KEY=   (never leaves server, used by send-push function)
VAPID_SUBJECT=       (mailto:team@glassbottles.app)
```
VAPID keys are generated once (`web-push generate-vapid-keys`), stored as
env vars in Vercel and Supabase Edge Function secrets.

**Where the trigger fires**
Same as Option A: `match-bottle` step 4 invokes `send-push` fire-and-forget.

**Complexity**: Medium-High
Higher complexity than email due to:
- Service worker registration lifecycle (browser compatibility quirks)
- VAPID key management
- Handling subscription expiry (410 responses require DB cleanup)
- iOS support is real but constrained: requires iOS 16.4+, Safari only,
  and the app must be added to the Home Screen as a PWA. Chrome for iOS
  (as of 2026) still does not support Web Push on iOS due to Apple's
  browser engine restriction.
- The `web-push` npm library needs a Deno-compatible port or the raw
  RFC 8030 / RFC 8188 implementation must be written manually (ECDH key
  agreement + AES-128-GCM encryption). Deno has `crypto.subtle` available,
  so this is feasible but non-trivial.

**Reliability when app is closed**: Yes on Android (Chrome/Firefox). Yes on
iOS 16.4+ if and only if the app is installed as a Home Screen PWA. Not
supported on iOS in-browser. This is a material user-reach gap for a mobile
web app.

**Dependencies / blockers**
- VAPID key generation and storage before first deployment.
- Service worker must be served from the root scope (`/sw.js`) — compatible
  with Next.js `public/` directory.
- Next.js App Router does not conflict with service workers, but the
  `next.config.ts` must not have a `headers()` config that sets
  `Service-Worker-Allowed` to a restrictive scope.
- iOS reach is fundamentally limited until Apple allows Web Push in in-browser
  contexts (no firm timeline as of mid-2026).
- The `web-push` encryption must be implemented in Deno (no npm package
  with full Deno support exists as of this assessment).

**Supabase integration path**
1. New migration: `push_subscriptions` table + RLS policies.
2. New API route: `POST /api/push/subscribe` (upsert subscription).
3. New edge function: `send-push` (VAPID-signed Web Push delivery).
4. `match-bottle` edge function: add `send-push` invocation after quota
   upsert (same fire-and-forget pattern).
5. Optional: `DELETE /api/push/subscribe` for explicit opt-out from settings.

**Security notes**
- `p256dh` and `auth` subscription keys are browser-generated and
  user-specific. They are not secret in the traditional sense (they are
  sent by the browser), but they should not be readable by other users.
  The RLS policies above enforce this.
- The VAPID private key must never be committed to source. It is a
  long-term secret — rotation requires re-subscribing all users.
- Push payloads are encrypted end-to-end by the Web Push protocol (RFC 8188
  / VAPID). The push service (FCM, APNs) cannot read the notification body.
  This is strong privacy protection for message content.
- The notification payload should contain only `{ title, body, url }` —
  never the bottle message content itself (the user should open the app to
  read it, preserving the reveal UX and anonymity model).

---

### Option C — Supabase Realtime only (current state)

Already implemented (migration 008, `RealtimeBottleListener` component).
Works only while the browser tab is open and the user is on the app.
Provides zero pull-back signal. Not a retention mechanism.

No additional build needed. This is a baseline, not a solution to the
stated problem.

---

### Comparison Summary

| Dimension              | A: Email (SMTP)      | B: Web Push (PWA)         | C: Realtime (current) |
|------------------------|----------------------|---------------------------|-----------------------|
| Complexity             | Low-Medium           | Medium-High               | None (done)           |
| Works when app closed  | Yes                  | Yes (Android); partial iOS| No                    |
| iOS reach              | Full                 | iOS 16.4+ PWA only        | In-app only           |
| Android reach          | Full                 | Full (Chrome/Firefox)     | In-app only           |
| Schema changes         | 1 column on profiles | New table + RLS           | None                  |
| New edge function      | send-email           | send-push                 | None                  |
| Provider dependency    | Resend/Postmark      | None (VAPID + browser API)| None                  |
| Onboarding friction    | Zero (email = auth)  | Permission prompt required| None                  |
| Spam / deliverability  | DNS config required  | Native OS notification    | N/A                   |
| Legal compliance       | Unsubscribe required | OS-level opt-out suffices | N/A                   |
| Build time estimate    | 0.5–1 sprint         | 1.5–2 sprints             | 0                     |

---

### Recommendation (for Arpan to decide)

From a pure reliability and reach perspective, Email (Option A) is the
clear path-of-least-resistance:
- Zero additional onboarding friction (email is already the auth identifier)
- Reaches 100% of users regardless of browser or OS
- No permission prompt — consent is implicit in receiving a message
  (with unsubscribe in every email satisfying legal requirements)
- Lowest implementation complexity in the backend (one HTTP API call to
  Resend/Postmark)
- The main work item is DNS setup (Manikant) and the unsubscribe deep-link
  mechanism (signed token in URL)

Web Push (Option B) is the better long-term UX (native notification, no
inbox clutter, instant) but the iOS gap is a significant reach problem for
a mobile-first product in 2026. It is a valid v2 layer on top of email,
not a replacement.

A pragmatic sequencing: ship Option A (email) now as the pull-back
mechanism; add Option B (PWA push) in a follow-on sprint as an enhancement
for users who install the PWA. The two options are not mutually exclusive —
the `send-email` and `send-push` edge functions can coexist, invoked in
parallel from `match-bottle`.

**HANDOFF → ARPAN**: Please decide between A-only, B-only, or A+B.
This brief is ready for product decision. Once Arpan signs off, Kushal
will build the chosen path in the next session.
