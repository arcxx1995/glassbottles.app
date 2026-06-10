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
