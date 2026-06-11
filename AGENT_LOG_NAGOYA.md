# AGENT_LOG_NAGOYA.md

---

## Session: 2026-06-11 — Product Gap Triage (5 gaps surfaced by founder)

### Context

Pre-beta audit. No prior Nagoya log exists; this is the founding entry. Five gaps were surfaced. I read the full codebase state before triaging: settings page, home page, layout, schema migrations, and all agent definitions were reviewed. Findings below are grounded in what is and is not in the code.

---

## Gap Triage

---

### GAP-001 — Email notification via Resend (fallback/alternative to WhatsApp)

**Priority: P1 — Beta blocker**

**Owner: Felix (backend route + Resend SDK integration), Shiv (env var, secret management)**

**Blocks beta: YES**

**Reasoning:**
WhatsApp notification is the only pull-back path in the system today. US-004 is currently satisfied only for users with a verified WhatsApp number. The moment we onboard users who skip WhatsApp setup — which will be the majority in early beta — there is no notification at all when their bottle arrives. Zero notification = zero read rate. Read rate is a core KPI. Without a fallback, beta retention data will be structurally misleading.

Decision: Resend is confirmed. Email is the fallback, not a replacement. If a user has WhatsApp verified, WhatsApp fires. If not, Resend fires. If both are absent (edge case: no email either — impossible since sign-up requires email magic link), no notification is sent and the in-app inbox is the only path.

**Spec — done looks like:**
- A new Supabase Edge Function `notify-receiver` is invoked after `receiver_id` is assigned to a bottle. It checks `profiles.whatsapp_verified`; if true it fires the existing WhatsApp template, otherwise it fires a Resend transactional email to the user's `auth.users.email`.
- The email contains a single CTA: "Open your bottle" linking to `/inbox`. Subject line: "Someone threw a bottle your way." No message preview in the email — preserve the discovery moment.
- `RESEND_API_KEY` added to `.env.example` and Vercel secrets (Shiv). `whatsapp_logs` table gains an `email_sent BOOLEAN DEFAULT FALSE` column or a parallel `email_logs` table (Felix decides; lean toward parallel table for clean separation).

**Acceptance criteria:**
1. User with no WhatsApp receives Resend email within 60 seconds of `receiver_id` being assigned.
2. User with verified WhatsApp receives WhatsApp message, not email (no double-notify).
3. Email contains no message content — only the CTA link.
4. If Resend call fails, error is logged to `email_logs` with status, no crash, no retry storm (log and move on; user can still open inbox).
5. `RESEND_API_KEY` is never logged, never returned to client.

---

### GAP-002 — "Still sailing" state missing on home screen

**Priority: P0 — Beta blocker**

**Owner: Bella (frontend UI state), Felix (confirm API surface exposes sailing status)**

**Blocks beta: YES**

**Reasoning:**
This is the highest-severity gap. When a user throws their bottle and no eligible receiver exists, `receiver_id` remains NULL. The home page today shows the identical "Bottle sent / Somewhere out there, a stranger will find it" UI regardless of whether the bottle is matched or floating. The user has no signal. They will think the app is broken. They will not return tomorrow. This kills Day 1 to Day 2 retention — our most critical cohort survival window — before we have any data to act on.

Edge case 1 in the canonical list already specifies this: "No eligible receiver → bottle queued, show 'still sailing' state." It was never built.

**Spec — done looks like:**
- `GET /api/bottles/today` response already returns the bottle's `receiver_id` (or null). Bella reads `todayStatus.bottle.receiver_id === null` as the "sailing" condition on the frontend.
- The `thrown` state in `home/page.tsx` branches: if `receiver_id` is null, render the "Still sailing" variant; if not null, render the current "Bottle sent" variant.
- "Still sailing" copy: "Your bottle is still at sea." + sub-copy: "We'll notify you when it finds someone." Bottle animation: slower bob, lower opacity glow — conveys gentle drift rather than celebratory arrival. No DailyTimer on this state (timer is for next throw, which is already used up; showing it here creates confusion about what is being counted down).
- When a match occurs (Supabase Realtime subscription fires on `bottles` UPDATE where `receiver_id` IS NOT NULL), the UI transitions from "still sailing" to "Bottle sent" without requiring a page reload.

**Acceptance criteria:**
1. User who throws when no receiver is available sees "still sailing" copy and animation, not "Bottle sent."
2. User who throws and is immediately matched sees "Bottle sent" copy.
3. If a match occurs while the user has the app open, UI updates within 5 seconds via Realtime — no refresh required.
4. `GET /api/bottles/today` must include `receiver_id` (nullable) in its response shape — Felix to confirm this is already exposed or add it.
5. "Still sailing" state passes `prefers-reduced-motion` test (Bella: static bottle, no pulsing glow).

---

### GAP-003 — Settings page is read-only (timezone picker + WhatsApp number input missing)

**Priority: P1 — Beta blocker**

**Owner: Bella (UI inputs + form submission), Felix (confirm PATCH /api/profile exists and accepts timezone + whatsapp_number)**

**Blocks beta: YES**

**Reasoning:**
US-009 (opt in/out of WhatsApp notifications) was explicitly flagged as BLOCKED because Bella never shipped the WhatsApp number input. Without a WhatsApp number, WhatsApp notifications cannot be enabled. Without notifications, the notification opt-in KPI is unmeasurable. Timezone is a softer issue — UTC reset works for everyone — but the input field exists in the schema and was designed to be user-configurable. Shipping a settings page that has no editable fields is a credibility issue at beta.

**Spec — done looks like:**
- Settings page gains two new interactive rows under a "Preferences" section label.
- **Timezone picker:** A `<select>` (or shadcn/ui combobox) pre-populated with the user's current timezone from the profile, listing IANA timezone names (use `Intl.supportedValuesOf('timeZone')` in the browser). On change, fires `PATCH /api/profile` with `{ timezone }`. Shows a transient "Saved" confirmation in the row's `meta` slot.
- **WhatsApp number:** A text input accepting E.164 format (e.g., +14155552671). Validation: client-side regex before submission, server-side format check in Felix's route. On save, updates `profiles.whatsapp_number` and sets `whatsapp_verified = false` (re-verification flow is v2; for beta, we treat save as provisional). Shows "Number saved — notifications enabled" confirmation.
- Both inputs follow the existing `SettingsRow` visual pattern but enter an edit mode when tapped (inline edit, not a modal).

**Acceptance criteria:**
1. Timezone picker shows the user's current saved timezone as selected value on page load.
2. Selecting a new timezone fires `PATCH /api/profile` and shows "Saved" without page reload.
3. WhatsApp number input validates E.164 format client-side; shows inline error for invalid format.
4. Saving a valid WhatsApp number persists to `profiles.whatsapp_number` and sets `whatsapp_verified = false`.
5. WhatsApp number is never echoed back to the client in full after save — display masked: `+1 ••• ••• 2671` (last 4 digits visible). Felix enforces this in the GET response.
6. Empty WhatsApp number field (clearing + saving) sets `whatsapp_number = NULL` and `whatsapp_verified = false`.

---

### GAP-004 — No account deletion path

**Priority: P1 — Beta blocker**

**Owner: Felix (API route + DB cascade), Bella (UI confirmation flow in Settings)**

**Blocks beta: YES**

**Reasoning:**
We are about to collect real user data. GDPR Article 17 (right to erasure) and equivalent frameworks require a deletion path before any personal data is collected from real users. "Beta" does not exempt us — beta users are real users under the law. No deletion path means no legal basis to launch in the EU. Beyond compliance: trust. Any thoughtful user who reads the settings page and finds no way to leave will not trust the product with their messages. This is not v2 polish; this is table stakes for launch.

**Spec — done looks like:**
- Settings page gains a "Delete account" row under a new "Danger zone" section, rendered with destructive styling (coral, consistent with the existing `LogOut` row pattern).
- Tapping "Delete account" opens a confirmation modal (shadcn/ui AlertDialog): "This permanently deletes your account and all your messages. This cannot be undone." Two buttons: "Cancel" (dismisses) and "Delete my account" (coral, proceeds).
- On confirm, client calls `DELETE /api/account`. Felix's route: (1) verifies session, (2) calls `supabase.auth.admin.deleteUser(userId)`, (3) the existing `ON DELETE CASCADE` on `profiles(id) REFERENCES auth.users(id)` propagates deletion to `profiles`, which cascades to `bottles` (sender_id and receiver_id) and `daily_quotas`. Felix must verify cascade is complete — any orphaned rows in `whatsapp_logs` or future `email_logs` must also cascade.
- After deletion, client is redirected to `/` (landing/sign-in page). Session is invalidated server-side before redirect.

**Acceptance criteria:**
1. Tapping "Delete account" shows confirmation modal before any action is taken.
2. Confirming deletion calls `DELETE /api/account`, which deletes the auth user and all associated rows via cascade.
3. After successful deletion, user is redirected to `/sign-in` with no session cookie present.
4. Deleted user cannot sign back in with the same magic link (link expires or user no longer exists).
5. Felix: verify all tables with FK references to `profiles.id` have `ON DELETE CASCADE` — add any missing cascades in a new migration if needed.
6. `DELETE /api/account` returns 401 if called without a valid session.

---

### GAP-005 — No PWA manifest

**Priority: P2 — Post-beta (v1.1 milestone)**

**Owner: Shiv (manifest.json, service worker config), Bella (layout.tsx manifest link tag + theme-color meta)**

**Blocks beta: NO**

**Reasoning:**
Not having a PWA manifest does not prevent the app from functioning. Beta users reached via direct link will have a working experience in the browser. However, the cap on DAU is real — mobile users who install to home screen open daily at significantly higher rates than browser-only users. This is not v2 speculative work; it is a concrete DAU lever. I am placing it at P2 rather than P1 because: (a) the core loop must work first, (b) PWA install prompts only make sense once the core experience is worth installing, and (c) none of the 5 gaps above involve infrastructure complexity — Shiv can execute this in one session once the blocking items clear.

Service worker scope: offline support for this product is limited (all content is server-dependent), so the service worker's job is primarily to satisfy PWA installability criteria, not to enable offline mode. Cache the app shell; do not attempt to cache bottle content.

**Spec — done looks like:**
- `apps/web/public/manifest.json` created with: `name: "glassbottles"`, `short_name: "glassbottles"`, `start_url: "/home"`, `display: "standalone"`, `background_color: "#0a1628"` (ocean-deep), `theme_color: "#0a1628"`, icons at 192x192 and 512x512 (SVG-derived PNG, Bella supplies the bottle icon asset).
- `apps/web/app/layout.tsx` gains `<link rel="manifest" href="/manifest.json" />` and `<meta name="theme-color" content="#0a1628" />` in the `<head>` (via Next.js `metadata.manifest` or explicit tag — Shiv picks the cleanest Next.js 14 approach).
- A minimal service worker registered via Next.js 14 conventions (e.g., `next-pwa` or a hand-rolled `public/sw.js`). Shiv decides on the library; if `next-pwa` adds significant bundle overhead, hand-roll.
- Apple-specific meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-touch-icon` (180x180).

**Acceptance criteria:**
1. Lighthouse PWA audit passes "Installable" criteria (manifest present, service worker registered, HTTPS — Vercel handles HTTPS).
2. Chrome on Android shows "Add to Home Screen" prompt after two visits.
3. Installed app launches to `/home` (not `/`) in standalone mode (no browser chrome visible).
4. `background_color` and `theme_color` match ocean-deep (`#0a1628`) so the splash screen is on-brand.
5. Service worker does not cache bottle message content (no stale reads).

---

## Sprint Plan Update

### Beta-blocking queue (must ship before any real user onboarding)

| ID | Gap | Priority | Owner(s) | Depends on |
|---|---|---|---|---|
| GAP-002 | "Still sailing" state | P0 | Bella + Felix | Felix confirms `receiver_id` in API response |
| GAP-001 | Resend email notification | P1 | Felix + Shiv | — |
| GAP-003 | Settings: timezone + WhatsApp input | P1 | Bella + Felix | Felix: PATCH /api/profile route |
| GAP-004 | Account deletion | P1 | Felix + Bella | Felix: cascade audit |

**Sequencing note:** GAP-002 is P0 because it silently breaks the core loop today. It should move first. GAP-003 and GAP-004 can run in parallel across Felix and Bella once GAP-002 is in review. GAP-001 (Resend) is backend-only and can run independently of all UI work — Felix can start immediately.

### Post-beta queue (v1.1 milestone)

| ID | Gap | Priority | Owner(s) |
|---|---|---|---|
| GAP-005 | PWA manifest + service worker | P2 | Shiv + Bella |

---

## Open questions / decisions logged

1. **email_logs vs. whatsapp_logs extension (GAP-001):** Felix to decide schema. My preference is a separate `email_logs` table so the WhatsApp log stays clean and the two notification channels can be queried independently for the `WhatsApp opt-in rate` KPI.

2. **WhatsApp re-verification flow (GAP-003):** For beta, saving a number sets `whatsapp_verified = false` (provisional). We accept that beta notifications may not reach unverified numbers until we build the verification step. This is an acceptable beta trade-off — flagged for v1.1.

3. **"Still sailing" Realtime subscription (GAP-002):** Bella needs to add a Supabase Realtime subscription on the `bottles` table filtered to the current user's sent bottle of the day. Felix must confirm the Realtime replication is enabled for the `receiver_id` column (migration 008 covers replica identity — verify it covers this column).

4. **Cascade completeness (GAP-004):** Felix must audit all tables before shipping `DELETE /api/account`. The `whatsapp_logs` table references `receiver_id` (UUID, no explicit FK declared in migration 001) — Felix must check if this needs an explicit cascade or if the auth deletion path handles it.

---

*Nagoya — 2026-06-11*

---

## Session: 2026-06-11 — Magic Link Auth Redirect Bug (AUTH-BUG-001)

### Context

Felix is debugging a redirect failure after magic link click. I read the full auth surface before writing this: `sign-in/page.tsx`, `sign-up/page.tsx`, `auth/callback/route.ts`, `middleware.ts`, `AuthProvider.tsx`, `lib/supabase/client.ts`, and `store/authSlice.ts`.

---

### AUTH-BUG-001 — Sign-in page sends user to /home, bypassing /auth/callback

**Severity: P0 — Login is broken for all sign-in users**

**Owner: Felix (1-line fix)**

**Root cause:**

`sign-in/page.tsx` line 25 sets:
```
emailRedirectTo: `${window.location.origin}/home`
```

This tells Supabase to redirect the browser straight to `/home` after token verification, bypassing `/auth/callback` entirely. The PKCE code exchange never happens. No session cookie is written. The user arrives at `/home` without a session, middleware sees no user, redirects back to `/sign-in`. Infinite loop.

`sign-up/page.tsx` line 25 is already correct (`/auth/callback`) — only sign-in is broken.

**The fix:**

In `apps/web/app/(auth)/sign-in/page.tsx`, change line 25 from:
```
emailRedirectTo: `${window.location.origin}/home`
```
to:
```
emailRedirectTo: `${window.location.origin}/auth/callback`
```

That is the entire code change required.

---

### Expected user journey — magic link sign-in (canonical)

**Step 1 — User submits email on /sign-in**
Client calls `supabase.auth.signInWithOtp()` with `emailRedirectTo: ${origin}/auth/callback`.
UI transitions to "Check your inbox" state. No session exists yet.

**Step 2 — Supabase sends the email**
Supabase emails a link pointing to its own auth server with the verified redirect destination embedded:
`https://<project>.supabase.co/auth/v1/verify?token=...&type=magiclink&redirect_to=https://glassbottles.app/auth/callback`

**Step 3 — User clicks the link**
Browser hits Supabase Auth server. Supabase verifies the token and redirects to:
`https://glassbottles.app/auth/callback?code=<pkce_code>`
The `code=` param in the URL confirms PKCE flow (not implicit/legacy).

**Step 4 — /auth/callback route runs (server-side)**
`apps/web/app/auth/callback/route.ts` receives the GET request, calls `supabase.auth.exchangeCodeForSession(code)`, and the SSR client writes the session as an HttpOnly cookie on the response. Route redirects browser to `/home` (or the `next` param if present and same-origin).

**Step 5 — Middleware runs on /home**
`middleware.ts` calls `supabase.auth.getUser()`, which reads the session cookie. User is authenticated. Request passes through.

**Step 6 — Page loads, AuthProvider bootstraps**
`AuthProvider.tsx` runs `supabase.auth.getUser()` client-side, detects the session, fires `onAuthStateChange` with event `SIGNED_IN`, fetches `/api/profile`, dispatches `setUser(profile)` into Redux. App is fully hydrated and authenticated.

---

### Why the callback route is structurally correct and does not need changes

- `auth/callback/route.ts` correctly handles the PKCE code exchange and writes cookies via the SSR client.
- The middleware matcher explicitly omits `/auth/callback`, so the unauthenticated callback request passes through without being blocked.
- The callback route validates the `next` param against same-origin to prevent open redirect.
- On `exchangeCodeForSession` failure it redirects to `/sign-in?error=auth_failed` — never a 500.

No changes needed in this file.

---

### Why the middleware is not the cause

`middleware.ts` correctly:
- Redirects unauthenticated users away from `/home`, `/inbox`, `/settings`.
- Redirects authenticated users away from `/sign-in`, `/sign-up` to `/home`.
- Excludes `/auth/callback` from its matcher entirely.

The middleware is doing exactly the right thing. It redirects the user back to `/sign-in` because there is no session cookie — because the callback was never called. The middleware is surfacing the bug, not causing it.

---

### Acceptance criteria for AUTH-BUG-001

1. After the fix: clicking the magic link email lands the browser at `https://glassbottles.app/auth/callback?code=<value>`. The URL contains `code=`, not `access_token=`.
2. The callback route completes without error. A session cookie is visible in DevTools > Application > Cookies after the callback.
3. Browser is redirected to `/home` after the callback. No redirect to `/sign-in` occurs.
4. On `/home`, `supabase.auth.getUser()` returns a non-null user on the first call.
5. `/api/profile` returns HTTP 200 immediately after the callback redirect, not 401.
6. Navigating back to `/sign-in` while authenticated redirects to `/home` (middleware `isAuthRoute && user` branch fires correctly).
7. A second click on the same magic link redirects to `/sign-in?error=auth_failed` — codes are single-use.
8. The fix applies to the same email submitted from mobile browsers. The loop does not occur on iOS Safari or Android Chrome.

---

### Edge cases Felix must verify

**Expired link (>1 hour)**
`exchangeCodeForSession` will return an error. Route redirects to `/sign-in?error=auth_failed`. The sign-in page does not currently render a user-facing message for this error param. Felix: add a minimal read of `searchParams.get('error')` on the sign-in page to show "Your link expired — request a new one." This is a secondary fix; the loop fix is the priority.

**Already-authenticated user clicks a magic link**
The callback route exchanges the code (valid operation, does not error), sets a new session cookie, and redirects to `/home`. The middleware then sees an authenticated user and passes through. This is correct behavior — no loop, no error. The user just gets a refreshed session.

**Mobile deep links / in-app browsers**
When a user opens the magic link from the Gmail app on iOS, the link opens in an in-app browser that may not share cookies with Safari. The session cookie written by the callback is scoped to that in-app browser context. The user may appear logged out when they switch to Safari. This is a known limitation of in-app browser isolation. It is not introduced by this bug or this fix — it pre-exists. Documenting here for awareness; it is a v1.1 problem (universal link / custom URL scheme).

**No Supabase allow-list entry in production**
`config.toml` only governs local dev. In production, the Supabase dashboard must have `https://glassbottles.app/auth/callback` listed under Authentication > URL Configuration > Redirect URLs. If it is absent, Supabase rejects the redirect regardless of the code fix. Felix must verify this setting in the dashboard for project `fsjgccmtthbwvcqodmsx`. Also confirm the Site URL is set to `https://glassbottles.app`, not a localhost value.

**User submits email but closes the tab before clicking the link**
No issue. The link is valid for 1 hour. User can open it in any browser context that resolves to the production domain.

---

### Files to investigate / change

| Priority | File | Why |
|---|---|---|
| Fix immediately | `apps/web/app/(auth)/sign-in/page.tsx` line 25 | The root cause. One-line change. |
| Verify in dashboard | Supabase project `fsjgccmtthbwvcqodmsx` > Auth > URL Configuration | Redirect URLs allow-list + Site URL |
| Secondary fix | `apps/web/app/(auth)/sign-in/page.tsx` | Add `error` searchParam read to surface "link expired" copy |
| No change needed | `apps/web/app/auth/callback/route.ts` | Structurally correct |
| No change needed | `apps/web/middleware.ts` | Structurally correct |
| No change needed | `apps/web/components/providers/AuthProvider.tsx` | `onAuthStateChange` will fire SIGNED_IN correctly once the cookie is set |

---

*Nagoya — 2026-06-11*

---

## Session: 2026-06-11 — Magic Link Auth Flow Spec (for Felix)

### Context

Felix is debugging a redirect failure after magic link click. I read the full auth surface before writing this: `sign-in/page.tsx`, `sign-up/page.tsx`, `auth/callback/route.ts`, `middleware.ts`, `AuthProvider.tsx`, `lib/supabase/client.ts`, `lib/supabase/server.ts`, and `supabase/config.toml`.

The callback route exists and is structurally correct. The middleware explicitly excludes `/auth/callback` from its matcher. The `emailRedirectTo` in both sign-in and sign-up pages points to `${window.location.origin}/home` — which is wrong. See critical finding below.

---

### AUTH-SPEC-001 — Magic Link Redirect Flow

#### The correct end-to-end flow

**Step 1 — User submits email**
Client calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: ... } })`.
The `emailRedirectTo` value must be `https://glassbottles.app/auth/callback`.
Currently it is set to `${window.location.origin}/home` — this is the bug.

**Step 2 — Supabase sends the email**
Supabase Auth emails a magic link. The link format is:
`https://fsjgccmtthbwvcqodmsx.supabase.co/auth/v1/verify?token=...&type=magiclink&redirect_to=https://glassbottles.app/auth/callback`

Supabase validates that the `redirect_to` value is in the project's allowed redirect list before following it.

**Step 3 — User clicks the link**
Browser hits the Supabase Auth server. Supabase verifies the token, then redirects the browser to:
`https://glassbottles.app/auth/callback?code=<pkce_code>`
(PKCE flow — this is the default for email OTP in the `@supabase/ssr` package.)

**Step 4 — `/auth/callback` route runs**
`apps/web/app/auth/callback/route.ts` receives the GET request.
It calls `supabase.auth.exchangeCodeForSession(code)`.
The SSR client writes the session as an `HttpOnly` cookie on the response.
On success, the route redirects to `https://glassbottles.app/home`.

**Step 5 — Middleware runs on `/home`**
`middleware.ts` calls `supabase.auth.getUser()` which reads the session cookie.
User is authenticated. Middleware passes the request through.

**Step 6 — Page loads, AuthProvider bootstraps**
`AuthProvider` runs `supabase.auth.getUser()` client-side → detects the session → fetches `/api/profile` → dispatches `setUser(profile)` into Redux. App is fully authenticated.

---

### Critical finding — the bug

Both `sign-in/page.tsx` and `sign-up/page.tsx` pass:
```
emailRedirectTo: `${window.location.origin}/home`
```

This sends the user directly to `/home` after Supabase verifies the token — bypassing `/auth/callback` entirely. The PKCE code is never exchanged. No session cookie is ever written. The user arrives at `/home` without a session, middleware redirects them back to `/sign-in`, and they are stuck in a loop.

The fix is one line in each file:
```
emailRedirectTo: `${window.location.origin}/auth/callback`
```

---

### Secondary finding — Supabase dashboard allow-list

`config.toml` only covers local dev. In production, the Supabase dashboard for project `fsjgccmtthbwvcqodmsx` must have `https://glassbottles.app/auth/callback` listed under Authentication > URL Configuration > Redirect URLs. If it is not there, Supabase will reject the redirect and the link will fail even after the code is fixed.

Felix must verify this in the dashboard. It is not controlled by `config.toml` for the hosted project.

---

### Acceptance criteria — "magic link auth works correctly"

1. Clicking the magic link email lands the browser at `https://glassbottles.app/auth/callback?code=<value>` — the URL contains `code=`, not `access_token=` (confirms PKCE, not implicit flow).
2. `/auth/callback` route exchanges the code without error and writes a session cookie visible in DevTools > Application > Cookies (`sb-fsjgccmtthbwvcqodmsx-auth-token` or equivalent).
3. Browser is redirected to `/home` after callback. No intermediate redirect to `/sign-in` occurs.
4. On `/home`, `supabase.auth.getUser()` returns a user object (not null) on the first call.
5. `/api/profile` returns 200 (not 401) immediately after the callback redirect.
6. Hitting the sign-in page while authenticated redirects to `/home` (middleware `isAuthRoute && user` branch fires).
7. A second click on the same magic link returns `auth_failed` and redirects to `/sign-in?error=auth_failed` — codes are single-use.
8. On mobile (separate browser tab or in-app browser), the same flow completes without a loop — no user gets stuck on the sign-in page after clicking the email link.

---

### What Felix must do

| # | Action | File / Location |
|---|---|---|
| 1 | Change `emailRedirectTo` to `${window.location.origin}/auth/callback` | `apps/web/app/(auth)/sign-in/page.tsx` line 25 |
| 2 | Same change | `apps/web/app/(auth)/sign-up/page.tsx` line 25 |
| 3 | Verify `https://glassbottles.app/auth/callback` is in Redirect URLs allow-list | Supabase dashboard → Authentication → URL Configuration |
| 4 | Verify `https://glassbottles.app` is set as Site URL in the dashboard (not just `http://127.0.0.1:3000` from config.toml which is local-only) | Supabase dashboard → Authentication → URL Configuration |

Items 1 and 2 are the root cause. Items 3 and 4 are required for production to accept the redirect even after the code fix.

---

*Nagoya — 2026-06-11*
