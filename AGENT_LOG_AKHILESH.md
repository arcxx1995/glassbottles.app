# AGENT_LOG_AKHILESH.md — Code Reviewer

> Akhilesh's review notes, security findings, and quality gates.

## Initialization
**Agent**: Akhilesh  
**Role**: Code Reviewer  
**Mandate**: No code merges to main without Akhilesh sign-off.

### Review Log
| PR / Feature | Reviewed | Outcome | Notes |
|---|---|---|---|
| (none yet) | — | — | — |

### Standing Concerns (pre-code)
- Verify pg_cron quota check is atomic before Sprint 2 merge
- Confirm WhatsApp number encryption approach with Kushal before Sprint 3
- Audit RLS policies with Supabase test suite before any production deploy

---
<!-- Akhilesh appends sessions below this line -->

## 2026-06-10 — P0 Security Review (First Gate — No Prior Reviews)

### CRITICAL (block beta)

- `supabase/migrations/002_rls_policies.sql:41-43` — UPDATE policy has no column restriction: `USING (auth.uid() = receiver_id) WITH CHECK (auth.uid() = receiver_id)` permits a receiver to overwrite any column (message, sender_id, receiver_id, received_at, day_key, is_stale). **Status: FIXED by migration 005** (`REVOKE UPDATE ON bottles FROM authenticated; GRANT UPDATE (is_read, read_at, is_reported) ON bottles TO authenticated`). Migration 005 is correctly ordered and present. The original hole is closed. No action needed — confirmed.

- `supabase/functions/match-bottle/index.ts:1-101` — Edge function has no caller authentication. Any HTTP client that can reach the Supabase Functions endpoint can POST `{"bottle_id":"<uuid>"}` and force-assign any unmatched bottle to a receiver of their choice (by timing the call while `received_at IS NULL`). The `received_at IS NULL` UPDATE guard prevents double-assignment but does not prevent an attacker choosing their target. Fix: add JWT verification. Supabase Edge Functions verify the `Authorization: Bearer <jwt>` header by default unless `--no-verify-jwt` is set. Verify that this function is NOT deployed with `--no-verify-jwt`. Additionally, even with JWT verification, the caller merely needs to be any authenticated user — they do not need to be the sender. Fix properly: check that the `bottle_id` belongs to `auth.uid()` (the sender) before running matching logic:
  ```ts
  const { data: { user } } = await supabase.auth.getUser(
    req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  )
  if (!user) return new Response('Unauthorized', { status: 401 })
  // then verify bottle.sender_id === user.id
  ```
  Alternatively, call `match-bottle` from the API route using the service role key and add `Authorization: Bearer <service_role_key>` so it is never reachable by end users directly (which is the current call pattern — `service.functions.invoke(...)` in `bottles/send/route.ts`). That call already uses the service client, so the JWT sent will be the service role JWT. However, the function itself does not validate this. Add the check.

- `apps/web/app/api/bottles/count/route.ts:26-32` — Correctness blocker: `GET /api/bottles/count` is intended to return a global daily count ("ambient social proof") but the query runs through the user-session client (`createClient()` with anon key, RLS active). RLS SELECT policies on `bottles` only permit rows where `auth.uid() = sender_id` OR `auth.uid() = receiver_id`. The count therefore returns 0, 1, or 2 — not the global total. The feature is broken by design. Fix: use the service role client for this query only, or create a Postgres function with `SECURITY DEFINER` that returns `COUNT(*)` for today (no PII exposed). Simplest fix:
  ```ts
  // in count/route.ts — replace createClient() with createServiceClient() for the count query
  const service = createServiceClient()
  const { count, error } = await service
    .from('bottles')
    .select('id', { count: 'exact', head: true })
    .eq('day_key', today)
    .eq('is_stale', false)
  ```
  Auth check stays in place using the user-session client first; only the DB query uses service role.

- `supabase/migrations/002_rls_policies.sql:29-38` — Quota INSERT check TOCTOU: the RLS INSERT policy reads `daily_quotas` to check `has_sent = FALSE`, but this check and the INSERT are not wrapped in a single transaction — a concurrent second request from the same user can pass the RLS check in both sessions before either INSERT commits. **Status: PARTIALLY FIXED** by migration 004 (`UNIQUE (sender_id, day_key)` constraint on bottles). The UNIQUE constraint is the correct final-line-of-defense; the second concurrent insert will fail with `23505` (unique violation). However, `bottles/send/route.ts:82-89` only catches `42501` (RLS) and `23514` (CHECK constraint) — it does NOT catch `23505` (unique violation). A concurrent second send will return a 500 instead of a 429. Fix:
  ```ts
  if (
    insertError.code === '42501' ||
    insertError.code === '23514' ||
    insertError.code === '23505'   // unique violation: race on same sender+day
  ) {
    return NextResponse.json(
      { error: 'Already sent a bottle today. Come back tomorrow.' },
      { status: 429 }
    )
  }
  ```

### HIGH (fix before launch)

- `apps/web/app/api/profile/route.ts:56-66` — Timezone field has length check (`> 64`) but no format validation. A user can store arbitrary string content (e.g., `"<script>..."`, SQL strings) in the `timezone` column. While Supabase parameterises all queries (no SQL injection), stored XSS is possible if `timezone` is ever rendered without escaping. Fix: validate against a known-good IANA timezone list or at minimum enforce `^[A-Za-z_/+-]{1,64}$` regex:
  ```ts
  if (!/^[A-Za-z_/+\-]{1,64}$/.test(timezone)) {
    return NextResponse.json({ error: 'Invalid timezone format' }, { status: 400 })
  }
  ```

- `apps/web/middleware.ts:33-41` — Middleware protects `/home`, `/inbox`, `/settings` but the `/api/` routes are NOT in the matcher (line 47). All API routes enforce auth individually, which is correct, but there is no centralized enforcement. If a developer adds a new API route and forgets `auth.getUser()`, it will be unauthenticated by default. Advisory now, blocker risk as the codebase grows. Fix: add `/api/:path*` to the middleware matcher and either enforce auth there or log a warning that per-route auth is required.

- `supabase/functions/match-bottle/index.ts:55-58` — The receiver exclusion list is built by joining UUIDs with commas and passing them to `.not('id', 'in', \`(\${excludedIds.join(',')})\`)`. The comment says "UUIDs are hex + hyphens only — no SQL injection surface." This is accurate for Supabase's PostgREST `not...in` filter (values are URL-encoded, not interpolated into raw SQL). However, the `sender_id` and `user_id` values come from the database via the service role, so the injection surface is correctly assessed as zero. No code change needed, but the pattern should be documented as intentional.

- `supabase/migrations/006_match_retry_cron.sql` and `007_pg_net_notify.sql` — `retry_unmatched_bottles()` is `SECURITY DEFINER` with `SET search_path = public`. If any user can call this function directly (e.g., via PostgREST), they can force a matching run on demand, potentially revealing timing information about unmatched bottles. Fix: add `REVOKE EXECUTE ON FUNCTION public.retry_unmatched_bottles() FROM PUBLIC; REVOKE EXECUTE ON FUNCTION public.retry_unmatched_bottles() FROM authenticated;` — this is not blocked by default in Postgres.

- `apps/web/app/api/bottles/[id]/read/route.ts:23` and `[id]/report/route.ts:23` — `params.id` is used directly as a Supabase filter value (`.eq('id', id)`). Supabase PostgREST parameterises this correctly so there is no SQL injection. However, there is no UUID format validation on `id`. A path traversal or oversized input could reach Supabase unnecessarily. Fix: add `if (!/^[0-9a-f-]{36}$/.test(id))` check before the query.

### MEDIUM (fix in v2)

- `apps/web/app/api/bottles/status/route.ts:27` — `daily_quotas` is selected with `user_id` included in the response. `user_id` is the authenticated user's own UUID, which they already know, but it is marginally cleaner to omit it. Not a security issue.

- `apps/web/middleware.ts` — The middleware does not guard against `/sign-in` or `/sign-up` being accessed by an already-authenticated user. This causes no security issue but degrades UX (no redirect to `/home` for logged-in users visiting `/sign-in`).

- `supabase/config.toml:185` — `minimum_password_length = 6` is below the NIST SP 800-63b recommended minimum of 8. Raise to 8+ before production.

- `supabase/config.toml:229` — `enable_confirmations = false` for email auth means users can sign up and immediately use the app without verifying their email address. This enables spam account creation. Enable before launch.

- `apps/web/store/api/bottleApi.ts` — `sendBottle` mutation only invalidates `['BottleStatus']`, not `['BottleCount']`. The ambient counter will not refresh after sending. Advisory — add `'BottleCount'` to `invalidatesTags`.

- `apps/web/components/shared/RealtimeBottleListener.tsx:40` — Realtime filter uses `receiver_id=eq.${user.id}`. If the Supabase Realtime channel subscription fires before the user is assigned as receiver (the NULL->UUID transition), events may be missed. Migration 008 (`REPLICA IDENTITY FULL`) is the correct fix and is present. Confirmed correct.

- No hardcoded secrets found in any file. `SUPABASE_SERVICE_ROLE_KEY` is only referenced via `process.env` in `lib/supabase/service.ts` (server-only) and `Deno.env.get(...)` in the edge function. The browser client (`lib/supabase/client.ts`) uses only `NEXT_PUBLIC_*` keys. Clean.

- `supabase/migrations/002_rls_policies.sql:50` — `daily_quotas` has no INSERT or UPDATE policy for the authenticated role (comment says "edge function uses service role"). Confirmed correct — service role bypasses RLS. No client can insert/update quotas. Clean.

### VERDICT

BLOCK — Three issues require fixes before beta: (1) `match-bottle` edge function has no caller authentication and allows any authenticated user to trigger matching on arbitrary bottles; (2) `GET /api/bottles/count` returns 0-2 instead of the global daily total due to RLS, making the feature non-functional; (3) unique violation `23505` on concurrent bottle sends returns a 500 instead of a 429, confusing clients about the retry state.
