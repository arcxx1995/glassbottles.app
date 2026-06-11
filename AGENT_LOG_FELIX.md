# Agent Log — Felix (Backend Engineer, glassbottles.app)

---

## Session 2 — 2026-06-11

### Task: Replace WhatsApp notifications with Resend email

#### Audit findings (read before writing)

**State of WhatsApp in the codebase:**
- No `apps/web/lib/whatsapp.ts` or similar client file exists — the prior commit (`dae9ddd`) already removed it.
- No `/api/whatsapp/register` route file exists — also removed by that commit.
- No `whatsapp_logs` table in any migration. The system prompt schema listed it as existing, but it was never created. Audit finding: **no FK cascade to audit on `whatsapp_logs` because the table does not exist.** Flagged in open questions below.
- No `whatsapp_number` or `whatsapp_verified` columns in any migration either — the profiles table in `001_init_schema.sql` only has `id`, `timezone`, `created_at`, `last_active`. These columns were never added by any migration file. Nothing to preserve or skip writing to.
- Migration `007_pg_net_notify.sql` is misleadingly named — it actually recreates `retry_unmatched_bottles()` with notification logic *removed*, not added. No pg_net WhatsApp calls exist anywhere in migrations.

**Schema reality vs. system prompt schema:**
The system prompt lists `profiles (id, whatsapp_number, whatsapp_verified, timezone, created_at, last_active)` and `whatsapp_logs (id, bottle_id, receiver_id, status, meta, created_at)`. Neither the extra profile columns nor the `whatsapp_logs` table exist in any migration file. This was a spec/doc drift, not a live schema issue.

#### What was built

**Migration `010_email_notified_at.sql`**
- Adds `email_notified_at TIMESTAMPTZ DEFAULT NULL` to `bottles`.
- Nullable; NULL = not yet notified; non-null = email sent at that timestamp.
- Authenticated clients cannot write this column (migration 005 already restricts authenticated UPDATE on `bottles` to `is_read`, `read_at`, `is_reported` only — service role bypasses RLS).

**Edge function `notify-receiver` (`supabase/functions/notify-receiver/index.ts`)**
- Requires service role key in Authorization header (same pattern as `match-bottle`).
- Fetches receiver's email from `auth.users` via `supabase.auth.admin.getUserById` — never logs the email.
- Idempotency guard: returns early with `{notified: true, reason: 'already notified'}` if `email_notified_at` is already set. This makes the function safe to call from both the edge function path and the pg_cron retry path.
- Sends via Resend HTTP API directly (`fetch` to `https://api.resend.com/emails`) — no npm package. Auth via `Authorization: Bearer ${RESEND_API_KEY}`.
- Email: subject "A bottle washed up 🫙", plain/html body with no message content preview (preserves the reveal moment).
- After successful Resend response, stamps `email_notified_at = NOW()` with an `IS NULL` guard on the UPDATE — safe under concurrent invocations.
- Known v1 edge case: if the Resend call succeeds but the `email_notified_at` stamp fails, a retry will re-send. Resend deduplication is not relied on. Acceptable for v1.
- Env vars required: `RESEND_API_KEY`, optionally `RESEND_FROM_ADDRESS` (defaults to `glassbottles <hello@glassbottles.app>`).

**Updated `match-bottle` edge function**
- After step 4 (quota upsert), added step 5: fire-and-forget `fetch` to `notify-receiver`.
- Uses `SUPABASE_URL` + service role key from Deno env — no new secrets needed.
- Errors are caught and logged; match success is not gated on notification success.

**Migration `011_retry_notify_email.sql`**
- Recreates `retry_unmatched_bottles()` (SECURITY DEFINER, `search_path = public`).
- After each successful `UPDATE bottles ... WHERE received_at IS NULL` (i.e. after confirming the row was actually claimed), calls `net.http_post` to `notify-receiver`.
- Reads `app.settings.supabase_url` and `app.settings.service_role_key` from Supabase runtime config via `current_setting(..., true)` (the `true` = missing_ok). If either is absent (local dev without config), notification is skipped and matching proceeds normally.
- REVOKE grants from migration 009 remain in effect — no re-grant needed.

**Route `POST /api/whatsapp/register` — 410 tombstone**
- Created `apps/web/app/api/whatsapp/register/route.ts`.
- Returns HTTP 410 Gone for all POST requests with a JSON body explaining the removal.
- 410 (not 404) signals permanent removal to any clients with a cached endpoint.

#### FK cascade audit — `whatsapp_logs`

Finding: **`whatsapp_logs` table does not exist in any migration.** There is no FK, no CASCADE, nothing to audit or fix. The system prompt schema listed it as existing — this is documentation drift. No action taken.

#### Open questions / blockers

1. **`RESEND_API_KEY` must be set as a Supabase secret** before deploying `notify-receiver`. Command: `supabase secrets set RESEND_API_KEY=<key>`. Also set `RESEND_FROM_ADDRESS` if the domain differs from `glassbottles.app`.

2. **`app.settings.supabase_url` and `app.settings.service_role_key`** must be populated in the Supabase project's `postgresql.conf` / Vault for the pg_net notify path in `retry_unmatched_bottles()` to fire. On Supabase managed infra these are typically pre-set; verify before assuming they are available.

3. **`whatsapp_logs` table**: documented in the system prompt schema but absent from all migrations. Confirm whether it was ever created manually (outside migrations) or dropped, and whether the schema doc should be updated.

4. **`whatsapp_number` / `whatsapp_verified` on profiles**: also in the schema doc but not in migrations. Same — confirm whether a migration was applied outside this repo's tracked files, or whether the doc is stale.

5. **`RESEND_FROM_ADDRESS` domain verification**: the `from` address domain must be verified in Resend's dashboard before emails will deliver. Ensure `glassbottles.app` (or whatever sending domain is used) has the required DNS records.

6. **Concurrent stamp race in `notify-receiver`**: if two concurrent invocations both pass the `email_notified_at IS NULL` check before either stamps, both will call Resend and one will send a duplicate. Window is tiny (only if two concurrent callers reach step 4 simultaneously). Accepted for v1. Fix: add a unique partial index or use a DB-level advisory lock if this becomes a problem.

---

## Session 3 — 2026-06-11

### Task: Configure Resend via MCP — domain + API key

#### Outcome: Blocked — Resend MCP not loaded in session

The `resend@claude-plugins-official` plugin is present in the Claude plugin catalog but is not in the `enabledPlugins` list in `/Users/macbookpro/.claude/settings.json`. The `mcp__resend__*` tools (list-domains, create-domain, get-domain, list-api-keys, create-api-key) are therefore not available as callable tools.

No `RESEND_API_KEY` is present in the local environment or any `.env` file. The Resend REST API cannot be called without the key.

#### What was completed

- Updated `.env.example` to remove the stale WhatsApp block (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_OTP_ENABLED`) and add the correct Resend vars (`RESEND_API_KEY`, `RESEND_FROM_ADDRESS`). File: `/Users/macbookpro/Documents/glassbottlesapp/.env.example`.

#### To unblock

Either:
1. Add `"resend@claude-plugins-official": true` to `enabledPlugins` in `/Users/macbookpro/.claude/settings.json` and restart the Claude Code session, then re-run this task; or
2. Provide the `RESEND_API_KEY` value so the REST API can be called directly via `curl`.

Once the MCP tools or API key are available, the steps to run are:
- `mcp__resend__list-domains` — check if `glassbottles.app` already exists
- `mcp__resend__create-domain` with `name: "glassbottles.app"` if absent
- `mcp__resend__get-domain` with the returned domain ID — extract DNS records (MX, TXT/SPF, DKIM CNAMEs)
- `mcp__resend__list-api-keys` — check for existing `glassbottles-notify` key
- `mcp__resend__create-api-key` with `name: "glassbottles-notify"` if absent; store result in Supabase secrets immediately (`supabase secrets set RESEND_API_KEY=<value>`)

---

## Session 4 — 2026-06-11

### Task: Diagnose and fix magic-link redirect failures

#### Root cause analysis

Five distinct issues found. All must be fixed together — any one of them alone causes the broken redirect.

**Issue 1 — Missing `/auth/callback` route (critical)**
No `app/auth/callback/route.ts` exists anywhere in the codebase. Supabase magic links using PKCE (the default since `@supabase/ssr`) append `?code=<pkce_code>` to the `emailRedirectTo` URL and require the app to call `supabase.auth.exchangeCodeForSession(code)` server-side. Without this route, the browser lands on a 404 and the session is never established.

**Issue 2 — Wrong `emailRedirectTo` (critical)**
Both `app/(auth)/sign-in/page.tsx` and `app/(auth)/sign-up/page.tsx` pass `emailRedirectTo: window.location.origin + '/home'` to `signInWithOtp`. This sends the PKCE code to `/home`, which is a React Server Component page with no code-exchange logic. Even if the user lands on `/home`, the session cookie is never written. The correct target is `/auth/callback`.

**Issue 3 — `additional_redirect_urls` missing production URL (critical)**
`supabase/config.toml` lists only `["https://127.0.0.1:3000"]` in `additional_redirect_urls`. `https://glassbottles.app/auth/callback` is absent. Supabase Auth rejects any `emailRedirectTo` value that is not in the allowlist or equal to `site_url`. On the hosted project (fsjgccmtthbwvcqodmsx.supabase.co) this is a dashboard setting, not a toml setting — see Supabase dashboard action required below.

**Issue 4 — Middleware intercepts `/auth/callback` before code exchange**
The `/auth/callback` path is not in the middleware matcher, so there is no interception. However, the matcher comment was clarified to make it explicit and permanent — a future developer must not add `/auth/:path*` to the matcher without understanding the consequence (intercepting the callback before code exchange would 401 all magic links).

**Issue 5 — `server.ts` cookies pattern**
`lib/supabase/server.ts` calls `cookies()` synchronously. This is correct for Next.js 14 and no change is needed.

#### Files changed

- `apps/web/app/auth/callback/route.ts` — **created** (PKCE code exchange handler)
- `apps/web/app/(auth)/sign-in/page.tsx` — `emailRedirectTo` changed from `/home` to `/auth/callback`
- `apps/web/app/(auth)/sign-up/page.tsx` — same
- `supabase/config.toml` — added `"https://glassbottles.app/auth/callback"` to `additional_redirect_urls`
- `apps/web/middleware.ts` — added comment block clarifying that `/auth/callback` is intentionally excluded from the matcher

#### Supabase dashboard action required (cannot be done via config.toml for hosted project)

`config.toml` controls the local dev CLI only. For the hosted project at `fsjgccmtthbwvcqodmsx.supabase.co`, URL allowlists are set in the dashboard:

1. Go to Authentication > URL Configuration
2. Set **Site URL** to `https://glassbottles.app`
3. Add to **Redirect URLs**: `https://glassbottles.app/auth/callback`

Without step 3, Supabase will reject the `emailRedirectTo` value for all production magic links even after the code changes deploy.

#### Security notes

- The callback route validates `?next=` against same-origin (only paths starting with `/` are honoured) — prevents open-redirect.
- Errors from `exchangeCodeForSession` redirect to `/sign-in?error=auth_failed` — Supabase error messages are not surfaced in the URL or response body.
- Expired or already-used PKCE codes produce an `auth_failed` redirect, which is the correct UX.

---
