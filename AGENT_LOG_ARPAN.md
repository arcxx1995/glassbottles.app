# AGENT_LOG_ARPAN.md — Product Manager

> Arpan's PRD, sprint log, edge case decisions, and feature priorities.

## Initialization
**Agent**: Arpan  
**Role**: Product Manager  
**First Task**: Validate MASTER_PROMPT user stories, define acceptance criteria per story

### User Story Status
| ID | Story | Acceptance Criteria Defined | Sprint |
|---|---|---|---|
| US-001 | Magic link sign up | 🔲 | S1 |
| US-002 | Daily bottle on home | 🔲 | S2 |
| US-003 | Write & throw bottle | 🔲 | S2 |
| US-004 | WhatsApp notification | 🔲 | S3 |
| US-005 | Read received bottle | 🔲 | S3 |
| US-006 | One bottle/day quota | 🔲 | S2 |
| US-007 | Countdown timer | 🔲 | S3 |
| US-008 | Report message | 🔲 | S4 |
| US-009 | WhatsApp opt-in settings | 🔲 | S3 |

---
<!-- Arpan appends sessions below this line -->

## 2026-06-07 — Sprint 1 Completion Review

**Reviewed by**: Arpan  
**Status**: Both agents shipped. Integration handoff complete.

### What shipped

**Kushal (backend):**
- 4 DB migrations: schema, RLS, cron cleanup, race condition fix (UNIQUE constraint on sender_id+day_key)
- 7 API routes: send, status, received, read, report, profile, whatsapp/register
- 3 Supabase clients: browser, server (SSR-safe), service role (admin ops only)
- WhatsApp Cloud API client with 1+1 retry

**Ishan (frontend):**
- Full Next.js 14 App Router scaffold, zero TS errors
- 8 components: AppShell, BottomNav, BottleCanvas, ThrowAnimation, MessageEditor, ReceivedBottle, WaveBackground, DailyTimer
- RTK Query API slices (bottleApi, authApi) + UI slice
- 5 pages: home, inbox, settings, sign-in, sign-up
- Home page state machine: idle → composing → throwing → thrown

### US coverage after Sprint 1

| US | Feature | Shipped? |
|---|---|---|
| US-001 | Magic link sign up | ✅ sign-in/sign-up pages + auth middleware |
| US-002 | Animated bottle on home | ✅ BottleCanvas + WaveBackground |
| US-003 | Write & throw | ✅ MessageEditor + ThrowAnimation + /api/bottles/send |
| US-004 | WhatsApp notification | ✅ WhatsApp client + whatsapp/register route |
| US-005 | Read received bottle | ✅ ReceivedBottle + /api/bottles/received + read PATCH |
| US-006 | One send+receive/day | ✅ quota enforced server + UNIQUE DB constraint |
| US-007 | Countdown timer | ✅ DailyTimer (UTC reset, local display) |
| US-008 | Report message | ✅ /api/bottles/:id/report + is_reported flag |
| US-009 | WhatsApp opt-in settings | ✅ settings page + /api/profile PATCH |

### Open issues Arpan must track

1. **RLS UPDATE over-permission** (Kushal flagged): receiver can update ALL columns on bottles table, not just is_read/is_reported/read_at. Security hole. Fix before prod.
2. **WhatsApp OTP skipped** (Kushal flagged): whatsapp_verified = true on save, no OTP. v1 accepted. Block v2 launch without real verification.
3. **whatsapp_number masking in UI** (Kushal flagged): settings shows raw number in input. Ishan to mask as ••••1234 in v2 to align with "never in client state" principle.
4. **RTK Query passes userId param** to /api/bottles/status — route ignores it (uses session). Low priority clean-up.

### Arpan verdict

Core loop is shippable for closed beta: sign up → throw bottle → get WhatsApp → read → report. All 9 US covered. Race condition fixed atomically. No sender identity leak at SELECT level. Ship to 100 beta users; watch throw rate and read rate first.

---

## 2026-06-07 — Sprint Status Review + Next Build Plan

**Reviewed by**: Arpan

### Live preview to run now

```bash
cd /Users/macbookpro/Documents/glassbottlesapp
cp .env.example apps/web/.env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# (WhatsApp vars optional for UI preview — routes will 500 but UI renders)
cd apps/web && pnpm dev
# → http://localhost:3000
```

### Sprint completion map

| Sprint | Status | Notes |
|---|---|---|
| Sprint 0 — Foundation | ✅ Done | monorepo, Next.js, Supabase, CI/CD, .env |
| Sprint 1 — Auth + Core Shell | ✅ Done | auth, app shell, RTK store |
| Sprint 2 — The Bottle | ✅ Done | BottleCanvas, MessageEditor, ThrowAnimation, send API |
| Sprint 3 — Receiving + WhatsApp | ✅ Done | inbox, ReceivedBottle, DailyTimer, WhatsApp notify |
| Sprint 4 — Polish + Safety | 🟡 Partial | report ✅, skeletons ✅, error.tsx ✅ — Souryadeep pass ❌, Akhilesh review ❌ |
| Sprint 5 — Launch Prep | ❌ Not started | acceptance test, Vercel Analytics, final deploy |

### What's blocking beta launch (priority order)

**P0 — Security**
1. **RLS over-permission**: receiver UPDATE policy covers ALL columns, not just `is_read`, `is_reported`, `read_at`. Kushal must scope to those 3 columns. See migration 005 — confirm it closes the gap. → **Assign: Kushal**

**P1 — Quality gate**
2. **Akhilesh full review pass**: no PR to main has been reviewed. Must happen before any real user data enters. → **Assign: Akhilesh**

**P2 — Visual polish (Souryadeep)**
3. Souryadeep has zero logged design decisions. The design tokens are correct (implemented by Ishan). Souryadeep needs to audit the live preview and log approval or change requests per component. → **Assign: Souryadeep**

**P3 — Launch prep**
4. Vercel Analytics install + uptime monitor (UptimeRobot or Vercel built-in). → **Assign: Manikant**
5. Acceptance test all US-001 to US-009 against staging. → **Assign: Arpan + QA**

### Deferred to v2 (not blocking beta)
- WhatsApp OTP verification (currently whatsapp_verified = true on save, no OTP)
- Content moderation / profanity filter on message insert (Edge Function stub exists, logic TBD)
- "X bottles in the ocean right now" ambient social proof counter
- Audio/image bottle types (Supabase Storage ready, no UI)

### KPI instrumentation gaps (fix before beta read-out)
- No event tracking wired (throw rate, read rate, WhatsApp opt-in rate are unobservable)
- Decision: use Vercel Analytics for page views + custom `track()` calls for throw/read events
- Arpan to define event schema before Manikant instruments

---

## 2026-06-10 — Status Audit

**Agent**: Arpan  
**Task**: Full build status review

### What's built (confirmed via filesystem)

**Foundation (Sprint 0) ✅**
- pnpm monorepo
- Next.js 14 App Router scaffold
- 8 DB migrations (schema, RLS, cron, uniqueness, column restriction, match retry, pg_net notify, realtime replica identity)
- CI/CD GitHub Actions + Vercel config
- .env.example

**Auth + Shell (Sprint 1) ✅**
- Magic link sign-in/sign-up pages
- Auth middleware
- AppShell + BottomNav
- RTK store (authSlice, bottleSlice, uiSlice, bottleApi, authApi)
- AuthProvider + ReduxProvider

**The Bottle (Sprint 2) ✅**
- BottleCanvas, ThrowAnimation, MessageEditor components
- POST /api/bottles/send (quota enforced, idempotent)
- GET /api/bottles/status
- Home page state machine (idle → composing → throwing → thrown)

**Receiving + WhatsApp (Sprint 3) ✅**
- ReceivedBottle, DailyTimer, WaveBackground, BottleSkeleton
- OceanCounter, ReceivedBanner, RealtimeBottleListener
- GET /api/bottles/received, PATCH /api/bottles/[id]/read
- POST /api/bottles/[id]/report
- POST /api/profile (WhatsApp register)
- GET /api/bottles/count
- Inbox + Settings pages

**Polish + Safety (Sprint 4) 🟡 PARTIAL**
- ✅ Report endpoint
- ✅ Loading skeletons (BottleSkeleton)
- ✅ error.tsx, not-found.tsx, loading.tsx per route
- ❌ Souryadeep design audit (zero log entries — never ran)
- ❌ Akhilesh full code review (zero log entries — never ran)

**Launch Prep (Sprint 5) ❌ NOT STARTED**
- No Vercel Analytics
- No uptime monitoring
- No acceptance test run against US-001–US-009
- No final deploy verification

### What still needs building

| Priority | Item | Owner | Blocking beta? |
|---|---|---|---|
| P0 | Akhilesh full review pass | Akhilesh | YES |
| P0 | RLS UPDATE scope verify (migration 005 audit) | Kushal | YES |
| P1 | Souryadeep design audit of live components | Souryadeep | Soft yes |
| P2 | Vercel Analytics + `track()` for throw/read/opt-in | Manikant | No (but KPIs blind) |
| P2 | Event schema definition | Arpan | No |
| P2 | Acceptance test US-001–US-009 on staging | Arpan | Before launch |
| P3 | WhatsApp OTP verification | Kushal | v2 |
| P3 | Profanity filter logic (Edge Function stub exists) | Kushal | v2 |
| P3 | WhatsApp number masking in settings UI | Ishan | v2 |
| P3 | Ambient social proof counter ("X bottles sailing") | Ishan | v2 |

---

## 2026-06-10 — P2-A: Analytics Event Schema

**Author**: Arpan
**Decision**: Vercel Analytics handles page view telemetry. All product-level events use `@vercel/analytics` `track()`. Manikant instruments; this document is the authoritative contract.

### Install target

```
apps/web/lib/analytics.ts   ← thin wrapper, re-exports track() with typed overloads
```

No events are fired server-side. All six events are fired from client components at the exact moment the user action completes (not on intent, not on navigation). Every event must be callable in a single `track()` call with no async dependencies beyond what the component already holds.

---

### Event 1 — `bottle_thrown`

Fired immediately after `sendBottle().unwrap()` resolves successfully in `apps/web/app/(app)/home/page.tsx` inside `handleThrow()`.

```ts
{
  event: 'bottle_thrown',
  properties: {
    day_key: string,           // required — YYYY-MM-DD UTC, taken from bottle.day_key in the API response
    message_length: number,    // required — trimmed character count of the message sent (from Redux store at throw time)
    matched_immediately: boolean  // required — true if bottle.received_at is non-null in the API 201 response; false if null (queued / "still sailing")
  }
}
```

Implementation note: the POST /api/bottles/send response already includes `received_at`. If `received_at !== null`, the match happened synchronously via the edge function. This is the only way Manikant can derive `matched_immediately` without a second request.

KPI this feeds: throw rate (DAU denominator), match rate.

---

### Event 2 — `bottle_read`

Fired immediately after `markBottleRead(bottle.id).unwrap()` resolves in `apps/web/components/bottle/ReceivedBottle.tsx` (the component calls `useMarkBottleReadMutation`).

```ts
{
  event: 'bottle_read',
  properties: {
    time_to_read_ms: number    // required — Date.now() at fire time minus Date.parse(bottle.received_at); if received_at is null, omit the event entirely (should not happen in practice)
  }
}
```

`time_to_read_ms` is computed client-side as `Date.now() - new Date(bottle.received_at).getTime()`. The `bottle` object is already in scope when the mutation fires. Do not round — Vercel will aggregate.

KPI this feeds: read rate.

---

### Event 3 — `whatsapp_opted_in`

Fired in `apps/web/app/(app)/settings/page.tsx` (or whichever component owns the WhatsApp number save flow — currently settings page calls PATCH /api/profile with whatsapp_number). Fire after the PATCH resolves with 200 and the response confirms a non-null whatsapp_number.

Note: the current settings page (reviewed 2026-06-10) only has a sign-out button. Ishan has not yet shipped the WhatsApp number input. When she ships it, this is where the event goes. Manikant should instrument the opt-in alongside Ishan's settings expansion.

```ts
{
  event: 'whatsapp_opted_in',
  properties: {}  // no additional properties — we do not log the number
}
```

KPI this feeds: WhatsApp opt-in rate.

---

### Event 4 — `whatsapp_opted_out`

Fired in same component as `whatsapp_opted_in`, after PATCH resolves and confirms whatsapp_number has been set to null.

```ts
{
  event: 'whatsapp_opted_out',
  properties: {}  // no additional properties
}
```

---

### Event 5 — `auth_magic_link_sent`

Fired in `apps/web/app/(auth)/sign-in/page.tsx` inside `handleSubmit()` immediately after `supabase.auth.signInWithOtp()` resolves without error (i.e., when `setStatus('sent')` would be called). Also fire from `apps/web/app/(auth)/sign-up/page.tsx` in the equivalent location.

```ts
{
  event: 'auth_magic_link_sent',
  properties: {
    page: 'sign_in' | 'sign_up'   // required — literal string, passed as a constant from each page
  }
}
```

---

### Event 6 — `auth_signed_in`

Fired in `apps/web/providers/AuthProvider.tsx` (or equivalent) inside the `onAuthStateChange` handler when the event is `SIGNED_IN`. Read `session.user.created_at` and compare to `Date.now()` — if the account was created within the last 60 seconds treat as `first_time: true`, otherwise `first_time: false`.

```ts
{
  event: 'auth_signed_in',
  properties: {
    first_time: boolean   // required — true if user.created_at within 60 s of now, false otherwise
  }
}
```

Do not fire this on every page load. The `onAuthStateChange` event `SIGNED_IN` fires once per actual sign-in (magic link click), not on session restoration. This distinction is already handled by the Supabase client SDK.

---

### Wrapper contract for Manikant

Create `apps/web/lib/analytics.ts`:

```ts
import { track as vercelTrack } from '@vercel/analytics'

type BottleThrownProps  = { day_key: string; message_length: number; matched_immediately: boolean }
type BottleReadProps    = { time_to_read_ms: number }
type WhatsappOptInProps = Record<string, never>
type WhatsappOptOutProps = Record<string, never>
type AuthMagicLinkProps = { page: 'sign_in' | 'sign_up' }
type AuthSignedInProps  = { first_time: boolean }

type TrackEvent =
  | { event: 'bottle_thrown';        properties: BottleThrownProps }
  | { event: 'bottle_read';          properties: BottleReadProps }
  | { event: 'whatsapp_opted_in';    properties: WhatsappOptInProps }
  | { event: 'whatsapp_opted_out';   properties: WhatsappOptOutProps }
  | { event: 'auth_magic_link_sent'; properties: AuthMagicLinkProps }
  | { event: 'auth_signed_in';       properties: AuthSignedInProps }

export function track({ event, properties }: TrackEvent): void {
  vercelTrack(event, properties)
}
```

All call sites import `track` from `@/lib/analytics`, never directly from `@vercel/analytics`. This keeps Vercel as a swappable implementation detail and gives us type safety at every call site.

---

## 2026-06-10 — P2-B: Acceptance Test Plan (US-001 to US-009)

**Author**: Arpan
**Scope**: Human QA tester running against staging (Vercel preview deploy). Tests are sequential within each US but US tests are independent of each other unless noted.
**Prerequisites**: staging URL known, staging Supabase instance seeded with no existing test data for the test email address used. Use a real email address that can receive email. Use a real WhatsApp-capable phone for US-004 and US-009 tests.

---

### US-001: Magic link sign up

**Setup**: fresh incognito window, staging URL, email address not previously used on staging

**Steps**:
1. Navigate to `https://[staging-url]/sign-up`
2. Enter a valid email address
3. Click "Send magic link"
4. Observe the page state
5. Open the email inbox for that address
6. Click the magic link in the email
7. Observe redirect and final page state

**Pass criteria**:
- After step 3: the button shows a loading spinner, then transitions to a "Check your inbox" confirmation state showing the entered email address. No error message visible.
- After step 5: an email from Supabase (or configured sender) arrives within 60 seconds. Subject line relates to glassbottles sign-in. Email contains exactly one clickable link.
- After step 6: browser redirects to `https://[staging-url]/home`. The user is authenticated (BottomNav is visible, "Sign in to send your bottle" copy is absent).

**Fail criteria**:
- Button stays in loading state longer than 10 seconds.
- Error message appears on valid email input.
- Email does not arrive within 5 minutes.
- Magic link redirects to an error page or /sign-in instead of /home.
- User lands on /home but is not authenticated (no nav, sign-in prompt still visible).

---

### US-002: Daily bottle animation on home screen

**Setup**: authenticated user (can reuse session from US-001), has NOT sent a bottle today, navigate to /home

**Steps**:
1. Navigate to `/home`
2. Observe the page while the status request loads
3. Observe the page once loading completes
4. Observe the bottle visual element
5. Note whether any animation is running

**Pass criteria**:
- During step 2: a skeleton placeholder is visible (prevents "Your bottle awaits" flash for users who already sent).
- After loading: a bottle graphic is visible on screen. The copy "Your bottle awaits" is present. A "Write a message" button is present.
- The bottle graphic has visible ambient animation (gentle motion — wave or bob). Animation is present but not distracting.
- The page does not show an inbox, a feed, follower counts, or any metric.
- On a device with `prefers-reduced-motion: reduce`, the bottle graphic is static (no animation) but still renders.

**Fail criteria**:
- Page loads and shows a blank or error state.
- "Your bottle awaits" copy flashes briefly then disappears for a user who has already sent (flash = fail; skeleton should cover this).
- Bottle graphic is absent.
- No animation on standard motion preference.
- Animation still runs with `prefers-reduced-motion: reduce`.

---

### US-003: Write message and throw bottle

**Setup**: authenticated user, has NOT sent a bottle today, on /home in idle state

**Steps**:
1. Click "Write a message"
2. Observe the transition
3. Type a message of 50 characters
4. Attempt to submit with empty message (clear the field first, then click throw)
5. Re-type the 50-character message
6. Click the throw / send button
7. Observe the animation
8. Observe the post-throw state

**Pass criteria**:
- After step 1: the MessageEditor component appears. Character counter visible. Throw button present but disabled if field is empty.
- Step 4: throw button remains disabled or shows validation error when field is empty. No network request fires.
- After step 6: throw animation plays (bottle arc, motion toward horizon, or equivalent).
- After animation: page transitions to "Bottle sent" state. "Sent today" badge visible in header. DailyTimer component shows countdown to UTC midnight.
- Refreshing the page while in thrown state: page loads directly into "Bottle sent" state (no flash of idle state), confirming server-side quota is restored correctly.

**Fail criteria**:
- Empty message submission reaches the server (check network tab — 400 is acceptable; the test is that the client blocks it first).
- Throw animation does not play.
- After throw: page still shows idle or composing state.
- Refresh shows idle state for a user who already sent (regression on quota restore).
- Character count allows more than 1000 characters.

**Additional step — 1000-char limit**:
- Paste a 1001-character string into the MessageEditor. Verify the input is capped at 1000 characters client-side and a counter or warning reflects the limit.

---

### US-004: WhatsApp notification on bottle receipt

**Setup**: two test accounts (Account A = sender, Account B = receiver). Account B has a valid WhatsApp number saved in settings. Use a device where WhatsApp is active on that number.

**Steps**:
1. Sign in as Account A
2. Send a bottle (US-003 flow)
3. In staging Supabase admin, manually assign Account B as the receiver of Account A's bottle (or wait for the match-bottle edge function if it runs in staging)
4. Wait up to 2 minutes
5. Check the WhatsApp number linked to Account B

**Pass criteria**:
- A WhatsApp message arrives on Account B's number within 2 minutes of the bottle being matched.
- Message copy references glassbottles (brand present).
- Message contains a link or instruction to open the app and read the bottle.
- The message does NOT reveal the sender's identity or message content.

**Fail criteria**:
- No WhatsApp message arrives within 5 minutes.
- Message reveals sender email or any PII.
- Message contains the bottle's message text (should not — only a notification, not the content).

**Note**: if WhatsApp Cloud API is not configured on staging, this test verifies the in-app notification path instead (see US-005). Mark WhatsApp notification as "staging-blocked, verify in prod" if keys are absent.

---

### US-005: Open app and read anonymous message in inbox

**Setup**: authenticated user (Account B from US-004, or any account that has received a bottle), navigate to /inbox

**Steps**:
1. Navigate to `/inbox`
2. Observe the bottle list
3. Click or tap on an unread bottle
4. Read the message
5. Close or scroll away from the bottle

**Pass criteria**:
- Inbox page shows at least one bottle card for Account B.
- Unread bottles have a visual indicator (badge, styling difference) distinguishing them from read bottles.
- Clicking the bottle reveals the full message text.
- The sender is never identified — no email, no name, no avatar, no identifier of any kind.
- After opening: the bottle is marked as read (visual indicator updates; unread badge count in header decrements).
- The read state persists on page refresh.

**Fail criteria**:
- Inbox page is empty despite a matched bottle existing.
- Any sender identifying information is visible.
- Is-read state does not update after opening.
- Read state does not persist after page refresh.

---

### US-006: One send and one receive per day maximum

**Setup**: authenticated user who has already sent a bottle today (post-US-003 state)

**Steps**:
1. Navigate to /home
2. Observe the page state
3. Open browser devtools network tab
4. Attempt to POST /api/bottles/send directly with a valid message body and the session cookie
5. Observe the API response
6. Navigate to /home again
7. Verify UI does not offer a "Write a message" button

**Pass criteria**:
- Step 2: home page shows "Bottle sent" state with countdown, not idle state.
- Step 4: direct API call returns HTTP 429 with body `{ "error": "Already sent a bottle today. Come back tomorrow." }`.
- Step 7: no button to write a second message is present. Countdown timer is shown.

**Fail criteria**:
- A second bottle can be sent (UI or API allows it).
- API returns 200 or 201 on a second send attempt.
- UI shows the write button to a user who already sent today.

**Receive quota**: verify that a user cannot receive two bottles on the same day. This is enforced at the match-bottle edge function level. QA tester should confirm via Supabase admin that no user has two bottles with `receiver_id = X` and the same `day_key`.

---

### US-007: Countdown timer to next bottle

**Setup**: authenticated user who has sent a bottle today, on /home in "Bottle sent" state

**Steps**:
1. Note the current UTC time
2. Observe the DailyTimer component on /home
3. Wait 65 seconds; observe the timer
4. Calculate expected time to midnight UTC
5. Navigate away to /inbox, then back to /home
6. Observe the timer value on return

**Pass criteria**:
- Timer displays hours, minutes, and seconds remaining until midnight UTC.
- Timer counts down in real time (the value after 65 seconds is approximately 65 seconds less than initial).
- Timer displays the countdown in the user's local time context (i.e., the label says "next bottle in" or equivalent, not a raw UTC timestamp).
- On return from navigation (step 6): timer is still accurate, no frozen or reset state.
- At midnight UTC exactly: timer resets, home page transitions back to idle state (bottle appears, "Write a message" button available).

**Fail criteria**:
- Timer shows a negative number or "NaN".
- Timer is static (not counting down).
- Timer shows a UTC timestamp instead of a human-readable countdown.
- Timer resets to wrong value on navigation.
- At midnight UTC: quota does not reset and idle state does not return.

**Edge case to verify**: if tester's local time is far from UTC (e.g., UTC+9 or UTC-5), the countdown still targets UTC midnight, not local midnight. Verify by checking the displayed time matches the calculated UTC midnight delta.

---

### US-008: Report abusive message

**Setup**: authenticated user who has received a bottle in their inbox, on /inbox

**Steps**:
1. Open a received bottle
2. Locate the report action (button, link, or menu item)
3. Click the report action
4. Confirm the report (if a confirmation dialog exists)
5. Observe the post-report UI state
6. In Supabase admin, check the bottle record for Account B's received bottle

**Pass criteria**:
- A report action is accessible from within the bottle view.
- After confirming: the UI acknowledges the report (toast, state change, or copy update). The bottle is not deleted from the user's view — it remains but may be visually marked.
- No automatic action is taken against the sender (soft flag only at beta).
- In Supabase admin (step 6): the bottle's `is_reported` column is `true`. The `sender_id` is still present in the database (not deleted — admin review happens later).
- Reporting the same bottle a second time does not create a duplicate flag or throw an error (idempotent).

**Fail criteria**:
- No report action is visible to the receiver.
- Report causes an error (5xx).
- `is_reported` column remains `false` in the database after reporting.
- Bottle is deleted immediately on report (should not be — soft flag only).
- Reporting twice causes a 500 or database conflict.

---

### US-009: Opt in and out of WhatsApp notifications in settings

**Setup**: authenticated user, navigate to /settings. Note: as of 2026-06-10, the WhatsApp number input is not yet shipped in the settings page (Ishan has this as a v2 item). This test should be run once Ishan ships the settings expansion. Mark as BLOCKED until then.

**Steps (once settings WhatsApp UI is shipped)**:
1. Navigate to `/settings`
2. Locate the WhatsApp number input
3. Enter a valid E.164 phone number (e.g., +15550001234)
4. Save
5. Observe confirmation
6. Verify a WhatsApp test message is sent to that number (if staging WhatsApp is configured)
7. Return to settings, remove the number or toggle notifications off
8. Save
9. Observe confirmation

**Pass criteria**:
- After step 4: settings page confirms the number is saved. A PATCH to /api/profile with `whatsapp_number` returns 200.
- The number is not displayed in full in the UI — masked as e.g. `+1 ••••••0234` (v2 requirement, but note here for QA awareness).
- After step 6: a WhatsApp message arrives on the provided number confirming opt-in (if Cloud API configured).
- After step 8: settings confirm opt-out. Subsequent bottle receipts do not generate WhatsApp messages.
- In Supabase admin: `profiles.whatsapp_number` is null after opt-out.

**Fail criteria**:
- PATCH /api/profile returns non-200.
- The full phone number is visible in the UI (privacy issue — log as a defect against the v2 masking requirement).
- After opt-out: WhatsApp messages continue to be sent (check via staging WhatsApp logs or webhook inspection).
- `profiles.whatsapp_number` remains non-null after opt-out.

**Blocked note**: this test is explicitly blocked until Ishan ships the WhatsApp number field in the settings page. The API route (POST /api/profile via the whatsapp/register path, and PATCH /api/profile) exists and is testable via direct API calls in the interim.

---

### Test run log template

```
Date:
Tester:
Staging URL:
Browser:

| US    | Result  | Notes |
|-------|---------|-------|
| US-001 |        |       |
| US-002 |        |       |
| US-003 |        |       |
| US-004 |        |       |
| US-005 |        |       |
| US-006 |        |       |
| US-007 |        |       |
| US-008 |        |       |
| US-009 | BLOCKED — awaiting Ishan settings expansion |
```

---

## 2026-06-11 — Full PM Assessment (Sprint Status + Gaps + Priorities)

**Author**: Arpan
**Scope**: Cross-agent review of all sessions (Kushal 1–9, Ishan 1–7, Souryadeep 1, Akhilesh P0 review). Answers "what is pending, what can be better."

---

### 1. WHAT IS DONE — Sprint status by agent

**Kushal (Backend) — Sessions 1–9: Functionally complete, security hardened**
- 9 DB migrations shipped and applied in order: schema, RLS, cron, uniqueness constraint, column-level grants, hourly retry cron, pg_net notify, Realtime replica identity, revoke public execute on retry function
- 7 API routes: send, status, received, read, report, profile, bottles/count
- Edge function: match-bottle (SQL injection fixed, service role auth check added, Session 8)
- Security fixes: all 3 Akhilesh CRITICAL items and 4 HIGH items resolved across Sessions 8–9
- WhatsApp removed cleanly (Session 7): zero traces in backend code
- v2 OTP infrastructure built and feature-flagged off (Sessions 6), then deleted with WhatsApp removal (Session 7)
- UUID validation on param routes, centralized middleware API guard, config.toml security defaults raised (Session 9)
- 2 MEDIUM items deferred by Arpan decision: daily_quotas.user_id in status response (cosmetic), sign-in redirect for auth users (now fixed by Ishan Session 7)

**Ishan (Frontend) — Sessions 1–7: Functionally complete, tokens aligned**
- 8 components: AppShell, BottomNav, BottleCanvas, ThrowAnimation, MessageEditor, ReceivedBottle, WaveBackground, DailyTimer
- 5 pages: home, inbox, settings, sign-in, sign-up
- 3 additional components: BottleSkeleton, RealtimeBottleListener, OceanCounter, ReceivedBanner
- Home page state machine: idle → composing → throwing → thrown
- RTK Query: bottleApi, authApi (notificationApi deleted with WhatsApp removal)
- Sprint 4 polish: skeletons, error.tsx, not-found.tsx, loading.tsx per route
- Session 7: token alignment with Souryadeep Session 1, sign-in redirect for auth users, BottleSVGDynamic fallback, skeleton utility migration on loading routes

**Souryadeep (Design) — Session 1: Design system hardened, Settings page rebuilt**
- tailwind.config.ts: major expansion with semantic aliases, shadow/radius vocabulary, shimmer keyframe, motion tokens
- globals.css: CSS custom properties, skeleton utility, focus ring standardization
- Settings page: rebuilt from near-empty (42 lines post-WhatsApp) to full three-section layout (Privacy, About, Session)
- Home thrown state: emoji replaced with bobbing BottleSVG
- Pre-existing TS bug fixed (app/page.tsx Variants type)

**Akhilesh (Code Review) — 1 review pass (2026-06-10)**
- P0 review completed, blocking issues identified: 3 CRITICAL, 5 HIGH, 5 MEDIUM
- All CRITICAL and HIGH items resolved by Kushal Sessions 8–9 and Ishan Session 7
- Re-review of Session 8+9 changes has been requested by Kushal but NOT YET DONE
- Some items from the handoffs (Ishan Session 7) also pending Akhilesh verification

**Manikant (DevOps) — no log found**
- Supabase CLI setup documented by Kushal (Session 2)
- .env.example updated by Kushal
- No Vercel Analytics install confirmed
- No uptime monitor confirmed
- No AGENT_LOG_MANIKANT.md exists — Manikant has not run a single session

---

### 2. WHAT IS PENDING — Gaps, blocked items, open US

**P0 — Blocking beta launch**

| Item | Owner | Evidence |
|---|---|---|
| Akhilesh re-review of Session 8+9 fixes | Akhilesh | Kushal Session 9 explicitly requests re-review; no Akhilesh log entry exists post-2026-06-10 |
| Akhilesh review of Ishan Session 7 + Souryadeep Session 1 | Akhilesh | 3 open questions handed off by both agents; SettingsRow div[role=button] accessibility decision unresolved |
| Manikant has not started Sprint 5 | Manikant | AGENT_LOG_MANIKANT.md does not exist |
| Vercel Analytics not installed | Manikant | No log, no file evidence |
| Uptime monitoring not configured | Manikant | No log, no file evidence |
| Acceptance test run (US-001–US-009 on staging) | Arpan | Test plan written but no run recorded |

**P1 — US coverage gaps**

US-009 (WhatsApp opt-in/out): PERMANENTLY BLOCKED by design. WhatsApp was removed from the product (Kushal Session 7, Ishan Session 6). This user story is now invalid. Arpan decision: US-009 must be formally retired or rewritten as "user can manage notification preferences" for a future notification channel. The acceptance test plan marks it as blocked; it should now be marked as cancelled.

US-004 (WhatsApp notification): Same as US-009. The WhatsApp delivery mechanism no longer exists. US-004 is cancelled. The notification surface for "you received a bottle" is now: (a) Supabase Realtime in-app via RealtimeBottleListener, and (b) ReceivedBanner toast. These are functional for beta but represent a significant product scope reduction from the original spec.

All other user stories (US-001–003, US-005–008) are covered by shipped code.

**P2 — Settings page is functionally thin**

The settings page was rebuilt by Souryadeep as a three-section informational page (Privacy, About, Session). It has no functional settings inputs — no timezone, no notification preferences, no account deletion. This is acceptable for beta but means the only actionable thing a user can do in settings is sign out. This is a retention risk: users who want to manage their experience have no controls.

**P3 — Open handoff items not yet resolved**

From Souryadeep Session 1:
- `SettingsRow` accessibility: `div[role=button]` vs native `button` — Akhilesh decision pending
- `:focus-visible` coral rings: documented global standard, but remaining component-level coral rings not audited or removed
- Settings page `supabase.auth.getUser()` extra round-trip — Kushal to confirm session caching (unanswered)

From Ishan Session 7:
- Middleware auth redirect loop with Supabase magic link callback — Akhilesh to verify (unanswered)
- `ReceivedBottle shadow-card` rendering at `mx-4` — Akhilesh to verify (unanswered)
- `SettingsRow div[role=button]` — same as Souryadeep item above (unanswered)

From Kushal Session 9:
- `daily_quotas.user_id` in status response — deferred as cosmetic (Arpan accepts)
- v2: Supabase Vault for GUC key storage
- v2: pgp_sym_encrypt for pending OTP number (moot now that WhatsApp is removed)

**P4 — KPI instrumentation**

Analytics event schema was fully defined by Arpan (2026-06-10 session). The `apps/web/lib/analytics.ts` wrapper was specced. Manikant has not implemented it. Six events (bottle_thrown, bottle_read, whatsapp_opted_in/out, auth_magic_link_sent, auth_signed_in) are untracked. The first two are the most critical for beta read-out. Without them, throw rate and read rate — the two primary KPIs — are unobservable.

Note: whatsapp_opted_in/out events are now moot (WhatsApp removed). The analytics event schema needs a revision pass to remove those two events.

---

### 3. WHAT CAN BE BETTER — Prioritized improvements

**A. Product scope decision needed: what replaces WhatsApp notifications? (P0 product risk)**

WhatsApp was the primary engagement driver: the notification that pulled users back into the app. Its removal leaves a gap. Supabase Realtime works only while the app is open; ReceivedBanner fires only if the user is already in the app. There is no push notification path for users who have the app closed. This means the core loop — "throw a bottle, stranger gets a WhatsApp, opens app" — no longer works as designed. Before beta launch, Arpan must decide: (1) accept in-app-only for beta (limits reach but technically sound), or (2) add web push (PWA Service Worker + Supabase push), or (3) add email notification via Supabase Auth email (free, already configured). Without this decision, retention loop is broken at the most critical moment (someone throws their first bottle and never knows when it's received).

**B. The "still sailing" state has no UI (edge case 1 from spec)**

The spec says: "No eligible receiver today → bottle queued, show 'still sailing' state." The backend queues correctly (match-bottle retry cron, migration 006). The API POST /api/bottles/send returns `received_at: null` when no match happened. But Ishan's home page thrown state does not differentiate between "matched" and "queued/still sailing." Both show the same "Bottle sent" state. The matched_immediately flag in the analytics event schema acknowledges this distinction, but no UI uses it. Users who have their bottle queued get the same confirmation as matched users, which is misleading and misses the emotional beat: "your bottle is out there, sailing... it'll find someone soon." This is a small build but a meaningful UX gap.

**C. Settings page has no functional depth**

After WhatsApp removal, the settings page delivers no user control. For users who want to customize their experience (timezone for countdown display, notification preferences, account deletion), there is nothing. The member-since display and privacy explainer are good context but a settings page with no settings is a dead end. Minimum viable settings for beta: timezone selector (already in DB schema, already validated in API), and an account deletion flow (safety requirement before any real user data accumulates).

**D. The sign-up / onboarding has no first-time experience**

US-001 covers magic link sign-up. What happens on first sign-in is: user lands on /home, sees the bottle, can write. There is no "here's how this works" moment. The auth_signed_in event tracks first_time: true, but nothing in the UI acts on it. First-time users have no context for why the bottle is scarce, why it's anonymous, or what happens after they throw it. Given that the product mystery is intentional, the onboarding must walk the line between explaining enough and preserving the surprise. Minimum: a one-time modal or overlay on first sign-in that sets context in 3 lines. This is currently unspecced, undesigned, and unbuilt.

**E. Report flow has no confirmation UX**

US-008 is API-complete (is_reported flag in DB, /api/bottles/report endpoint). But there is no admin-facing review UI and no feedback loop to the reporter. A user who reports a message sees (per ReceivedBottle component) some UI acknowledgment, but the admin side is zero. For beta with real users, reported content accumulates in DB with no way to act on it except manual Supabase dashboard queries. This is a safety risk. Minimum: a simple read-only admin view showing reported bottles.

**F. Mobile viewport and PWA shell**

The app is designed mobile-first but there is no PWA manifest, no app icons, no home screen add prompt, and no service worker. Without these, users on mobile cannot add it to their home screen, which significantly reduces DAU (open-rate from home screen vs browser tab is ~3–5x). This is Manikant and Ishan work. Low effort, high impact.

**G. Akhilesh found coral focus rings fail WCAG — not yet fixed**

Souryadeep documented that `:focus-visible` should use seafoam globally, and that some components still have coral focus rings (sign-in button, home CTA). Coral on ocean-deep fails the WCAG 3:1 non-text contrast requirement for focus indicators. This is an accessibility blocker, not cosmetic.

**H. Dead state in Redux: selectIsAnimating, showReceivedBanner**

Ishan Session 4 noted `selectIsAnimating` is exported but never consumed. Ishan Session 5 noted `showReceivedBanner` and `setShowReceivedBanner` were wired but never consumed — though Session 5 also connected RealtimeBottleListener to dispatch `setShowReceivedBanner(true)`, so that one is now wired. `selectIsAnimating` remains dead. Not a bug, but dead state is a maintenance cost and a confused collaborator waiting to happen.

---

### 4. ARPAN'S RECOMMENDATION — Single most important thing to tackle next

**Akhilesh must complete his re-review of Sessions 8–9 (Kushal) and Session 7 (Ishan) before any other Sprint 5 work proceeds.**

Here is why this is the single highest priority:

All P0 security issues were fixed by Kushal in Sessions 8–9. Those fixes have been waiting for Akhilesh sign-off since 2026-06-11. The entire "go to beta" gate is Akhilesh's re-review. Nothing else Manikant, Ishan, or Arpan does matters if the code is not signed off.

Simultaneously, three open handoff questions (SettingsRow accessibility, magic link redirect loop, ReceivedBottle shadow clipping) are blocking design and frontend work from being considered "done." Akhilesh needs to answer them to close those branches.

The second most important thing — after Akhilesh's re-review comes back clean — is a concrete decision on the notification strategy replacing WhatsApp. Without pull-back notifications, DAU will be structurally limited because the only way a user learns they received a bottle is by opening the app. That makes the product a "check in occasionally" experience rather than a "respond to a notification" experience, which is a meaningful difference for daily active use.

**Recommended sprint sequence:**
1. Akhilesh: re-review Sessions 8–9 + answer 3 open handoffs (today)
2. Arpan: decide notification strategy (email notify vs web push vs in-app only for beta) — same day
3. Manikant: Vercel Analytics + uptime monitor + PWA manifest (Sprint 5 start)
4. Arpan: Update analytics event schema (remove WhatsApp events, add any new notification events)
5. Ishan: "still sailing" UI state + first-time onboarding overlay (small sprint)
6. Kushal: admin view for reported bottles (safety requirement before real users)
7. Arpan: acceptance test run against staging (gate before launch)

---

### US status — final map as of 2026-06-11

| US | Story | Status | Notes |
|---|---|---|---|
| US-001 | Magic link sign up | DONE | Auth middleware, magic link pages, AuthProvider, sign-in redirect |
| US-002 | Animated bottle on home | DONE | BottleCanvas, WaveBackground, Framer Motion bob |
| US-003 | Write and throw bottle | DONE | MessageEditor, ThrowAnimation, /api/bottles/send, quota enforced |
| US-004 | WhatsApp notification | CANCELLED | WhatsApp removed from product entirely (Sessions Kushal-7, Ishan-6) |
| US-005 | Read received bottle | DONE | ReceivedBottle, /api/bottles/received, PATCH read, Realtime |
| US-006 | One send + receive per day | DONE | UNIQUE constraint, daily_quotas, 429 on duplicate |
| US-007 | Countdown timer | DONE | DailyTimer UTC reset, local display |
| US-008 | Report message | DONE (partial) | API and UI done; admin review UI missing |
| US-009 | WhatsApp opt-in settings | CANCELLED | WhatsApp removed; settings page rebuilt without notification controls |

---

## 2026-06-11 — Acceptance Test Run: US-001 to US-009

**Author**: Arpan (Nagoya)
**Environment**: localhost:3001 (Next.js dev server), Supabase https://fsjgccmtthbwvcqodmsx.supabase.co
**Method**: Static code analysis — no shell execution tool was available in this session. Every verdict is evidence-based against specific file and line references. Items requiring live HTTP confirmation are marked STATIC-PASS or STATIC-FAIL accordingly. A human QA tester with shell access should run the LIVE-REQUIRED items to close the gap before beta.

---

### Test Run Log

```
Date: 2026-06-11
Tester: Arpan (automated static analysis)
App URL: http://localhost:3001
Supabase: https://fsjgccmtthbwvcqodmsx.supabase.co
Method: Code-path tracing against acceptance criteria

| US     | Result           | Method          | Notes |
|--------|------------------|-----------------|-------|
| US-001 | PARTIAL          | STATIC          | Auth pages and middleware correct; email delivery unverifiable without live run |
| US-002 | PASS             | STATIC          | BottleCanvas, animation, skeleton, idle state all confirmed in code |
| US-003 | PASS             | STATIC          | MessageEditor blocks empty/overlimit; server enforces 400+429; quota works |
| US-004 | REFRAMED / PASS  | STATIC          | WhatsApp removed; Realtime listener confirmed; banner fires on match |
| US-005 | PASS             | STATIC          | ReceivedBottle component, PATCH /read, RTK invalidation all correct |
| US-006 | PASS             | STATIC          | UNIQUE constraint + daily_quotas + 429 response confirmed in code |
| US-007 | PASS             | STATIC          | DailyTimer targets UTC midnight; counts down in real time; no NaN path |
| US-008 | PARTIAL          | STATIC          | API and UI confirmed; admin review UI missing (known gap) |
| US-009 | BLOCKED/CANCELLED| N/A             | WhatsApp removed; no notification controls exist in settings |
```

---

### US-001: Magic Link Sign Up — PARTIAL

**Evidence examined**: `apps/web/app/(auth)/sign-in/page.tsx`, `apps/web/app/(auth)/sign-up/page.tsx`, `apps/web/middleware.ts`

**Pass criteria verified (static)**:

1. Sign-in page calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '${origin}/home' } })`. On success it transitions to a "Check your inbox" state showing the entered email address (line 56–77 of sign-in/page.tsx). Confirmation state is implemented correctly.

2. On error the error message is displayed in coral text (line 97–99). Loading spinner present during submission (line 110–116). Button is disabled while `status === 'loading'` (line 103).

3. Sign-up page mirrors the same flow, uses the same `signInWithOtp` method (sign-up/page.tsx line 22). Both pages use `emailRedirectTo: '${window.location.origin}/home'`, so after clicking the magic link the user will land on `/home`.

4. Middleware (`middleware.ts` lines 50–55): authenticated users hitting `/sign-in` or `/sign-up` are redirected to `/home`. This prevents logged-in back-navigation regression.

5. Middleware (`middleware.ts` lines 43–47): unauthenticated users hitting `/home`, `/inbox`, `/settings` are redirected to `/sign-in`. Protected-route guard confirmed.

**Not verifiable without live execution**:
- Whether the Supabase project's email provider actually delivers the magic link email within 60 seconds. This depends on Supabase SMTP configuration and email deliverability — cannot be confirmed from code alone.
- Whether the magic link token (PKCE flow) correctly resolves and sets the session cookie on click. This requires a real browser with the actual token.

**Defect**: None found in code. LIVE-REQUIRED for email delivery confirmation.

**Verdict**: PARTIAL — code is correct; email delivery needs live confirmation.

---

### US-002: Daily Bottle Animation on Home Screen — PASS

**Evidence examined**: `apps/web/app/(app)/home/page.tsx`, `apps/web/components/bottle/BottleCanvas.tsx` (confirmed via glob), `apps/web/components/shared/WaveBackground.tsx`, `apps/web/components/shared/BottleSkeleton.tsx`

**Pass criteria verified (static)**:

1. Home page lines 79–114: when `isInitializing` is true (user loaded, status loading, no data yet) a `BottleSkeleton` is rendered instead of the idle state. This directly prevents the "Your bottle awaits" flash for users who already sent.

2. Home page lines 120–146: idle state renders `BottleCanvas` (the animated bottle) and the copy "Your bottle awaits" and a "Write a message" button. No likes, follows, follower counts, or metrics present anywhere in the component tree.

3. `BottleCanvas` is dynamically imported with `ssr: false` (line 24–27) — correct for canvas-dependent animation. Animation is provided by Framer Motion.

4. Home page thrown state (lines 183–225): the bottle re-renders with `animate={{ y: [0, -10, 0], rotate: [-1.2, 1.2, -1.2] }}` with `duration: 3.2, repeat: Infinity` — the bob animation is present on the thrown state, matching the bottle-bob design token.

5. `BottleSVGDynamic` has a loading fallback of an 80×120 transparent div (lines 36–41) — no layout shift.

**Not verifiable without live execution**:
- `prefers-reduced-motion` handling. No `useReducedMotion` hook or CSS `@media (prefers-reduced-motion: reduce)` guard is visible in the home page component. This is a potential FAIL on reduced-motion criteria. Ishan should verify whether Framer Motion's global `MotionConfig reducedMotion="user"` is set at the app layout level.

**Defect DEF-001** (minor): Framer Motion's `prefers-reduced-motion` respect is not explicitly configured in code reviewed. If `MotionConfig` is not set at root, the bottle bob animation will play even for users with reduced motion preference. This is a known Akhilesh/WCAG concern from the June-10 assessment.

**Verdict**: PASS on core criteria. DEF-001 flagged against reduced-motion requirement.

---

### US-003: Write Message and Throw Bottle — PASS

**Evidence examined**: `apps/web/components/bottle/MessageEditor.tsx`, `apps/web/app/(app)/home/page.tsx`, `apps/web/app/api/bottles/send/route.ts`

**Pass criteria verified (static)**:

1. **Empty message blocked client-side**: `MessageEditor.tsx` line 27: `const canSend = message.trim().length > 0 && !isOverLimit`. The throw button only renders when `canSend && onReady` (line 94). If field is empty, no button is shown — no network request can fire from the UI.

2. **1000-char limit enforced client-side**: `MAX_CHARS = 1000` (line 9). `remaining = MAX_CHARS - message.length` (line 24). `isOverLimit = remaining < 0` (line 26). Counter turns coral when over limit and `canSend` becomes false — button disappears. The textarea does not truncate at 1000 but the throw button becomes unavailable and the counter shows negative/red. NOTE: this does not hard-cap the textarea at 1000 chars on input — a user can type beyond 1000 and see the counter go negative, but cannot submit. This meets the acceptance criterion (blocked, counter reflects limit) though it differs from the "capped at 1000 chars client-side" phrasing in the test plan.

3. **1000-char limit enforced server-side**: `send/route.ts` line 41–45: `if (trimmed.length > 1000)` returns HTTP 400. Defense-in-depth confirmed.

4. **Empty message blocked server-side**: `send/route.ts` line 38–40: `if (!trimmed)` returns HTTP 400. Defense-in-depth confirmed.

5. **Throw animation**: Home page line 169–182: when `sendStatus === 'throwing'`, `ThrowAnimation` renders. `handleThrow()` dispatches `setSendStatus('throwing')` before the API call (line 63–64). The animation plays regardless of API outcome.

6. **Post-throw state**: `handleAnimationComplete()` dispatches `setSendStatus('thrown')` (lines 72–75). Thrown state shows "Bottle sent" copy and `DailyTimer` component.

7. **Refresh restores thrown state**: home page `useEffect` (lines 56–60): if `todayStatus.quota.has_sent === true` and `sendStatus === 'idle'`, dispatches `setSendStatus('thrown')`. This correctly restores state from server on page load.

8. **Quota enforcement**: `send/route.ts` steps 4 and 5: daily_quotas check returns 429, and DB UNIQUE constraint `bottles_sender_day_unique` (migration 004) provides atomic race-condition protection.

**Defect DEF-002** (minor UX): `MessageEditor` does not hard-cap input at 1000 chars — it allows typing beyond and shows a negative counter. The acceptance criterion says "input is capped at 1000 characters client-side." Technically the throw is blocked and the counter reflects the overrun, but the input itself is not capped. Low severity — the server also enforces it. However it does not match the acceptance test's exact wording. Flag for Ishan to add `maxLength={1000}` or a slice-on-change guard.

**Verdict**: PASS. DEF-002 flagged as minor.

---

### US-004: Notification on Bottle Receipt — REFRAMED / PASS (IN-APP ONLY)

**Context**: WhatsApp was removed from the product entirely (Kushal Session 7, Ishan Session 6). The original US-004 criteria (WhatsApp message within 2 minutes) no longer applies. Nagoya decision from the 2026-06-11 PM assessment: US-004 is cancelled as originally specced. The test here validates the replacement notification path.

**Evidence examined**: `apps/web/components/shared/RealtimeBottleListener.tsx`, `apps/web/components/shared/ReceivedBanner.tsx`, `apps/web/app/(app)/layout.tsx`

**Replacement path verified (static)**:

1. `RealtimeBottleListener.tsx`: subscribes to Supabase Realtime `postgres_changes` UPDATE events on `bottles` table filtered to `receiver_id=eq.${user.id}` (lines 35–48). When the edge function assigns `receiver_id`, this fires.

2. On firing: invalidates `BottleStatus` and `ReceivedBottles` RTK tags (lines 44–47) — inbox and status queries refetch automatically.

3. Dispatches `setShowReceivedBanner(true)` (line 49) — triggers the in-app toast notification.

4. The listener is mounted once in the app layout — persistent across navigation.

**What this does NOT cover**:
- Push notifications when the app is closed or backgrounded. There is no service worker, no PWA manifest, no web push subscription. This is the critical retention gap documented in the June-11 PM assessment (Item A). Users who close the app will not know when a bottle arrives.

**Verdict**: PASS for in-app notification path. BLOCKED for closed-app notification (no push infrastructure). This is an accepted product scope limitation for beta per Arpan June-11 assessment.

---

### US-005: Read Anonymous Message in Inbox — PASS

**Evidence examined**: `apps/web/app/(app)/inbox/page.tsx`, `apps/web/components/bottle/ReceivedBottle.tsx`, `apps/web/app/api/bottles/received/route.ts`, `apps/web/app/api/bottles/[id]/read/route.ts`

**Pass criteria verified (static)**:

1. **Inbox shows received bottles**: `inbox/page.tsx` calls `useGetReceivedBottlesQuery()` (line 13) which hits `GET /api/bottles/received`. The received route returns all bottles where `receiver_id = user.id` ordered by `received_at` descending (route line 23–32).

2. **Sender identity never revealed**: `received/route.ts` line 24: SELECT explicitly omits `sender_id`. RLS policy "bottles: receiver reads own" enforces `auth.uid() = receiver_id` at DB level. No sender identity can leak.

3. **Unread indicator**: `ReceivedBottle.tsx` line 26–30: when `!bottle.is_read`, a seafoam dot is rendered at the top right with `aria-label="Unread"`.

4. **Unread badge count in header**: `inbox/page.tsx` lines 26–31: `unreadCount = bottles.filter(b => !b.is_read).length`. Rendered as a coral circle badge when `unreadCount > 0`.

5. **Mark as read**: `ReceivedBottle.tsx` line 80–90: "Mark read" button calls `markRead(bottle.id)` which PATCHes `/api/bottles/${id}/read`. Route sets `is_read: true, read_at: now()` (read/route.ts lines 38–44). RTK invalidates `BottleStatus` and `ReceivedBottles` tags — UI refreshes.

6. **Idempotent read**: read route line 45: `.eq('is_read', false)` guard means if already read, the UPDATE is a no-op. Returns 200 either way.

7. **Read state persists on refresh**: is_read is stored in the DB, returned on every `getReceivedBottles` call. Refresh will show the updated state.

8. **No sender identity in component**: `ReceivedBottle` renders `bottle.message`, `bottle.sent_at`, `bottle.is_read`, `bottle.is_reported`. No sender field exists in the Bottle type returned by the API.

**Verdict**: PASS.

---

### US-006: One Send and One Receive Per Day Maximum — PASS

**Evidence examined**: `apps/web/app/api/bottles/send/route.ts`, `supabase/migrations/002_rls_policies.sql`, `supabase/migrations/004_bottle_send_uniqueness.sql`, `apps/web/app/(app)/home/page.tsx`

**Pass criteria verified (static)**:

1. **Server-side quota check (first guard)**: `send/route.ts` lines 51–63: queries `daily_quotas` for `user_id=user.id, date=today, has_sent=true`. If found, returns HTTP 429 with exact body `{ "error": "Already sent a bottle today. Come back tomorrow." }`.

2. **RLS INSERT policy (second guard)**: `002_rls_policies.sql` lines 29–38: INSERT policy checks `NOT EXISTS (SELECT 1 FROM daily_quotas WHERE user_id = auth.uid() AND date = CURRENT_DATE AND has_sent = TRUE)`. This guard runs at the DB layer regardless of API route code.

3. **UNIQUE constraint (third guard, atomic)**: `004_bottle_send_uniqueness.sql`: `UNIQUE (sender_id, day_key)`. Concurrent race conditions return error code `23505` which `send/route.ts` lines 86–89 maps to a 429 response.

4. **Quota upsert after send**: `send/route.ts` lines 97–108: after successful insert, service role upserts `daily_quotas` with `has_sent: true`.

5. **UI blocks second send**: home page `useEffect` (lines 56–60) restores `sendStatus = 'thrown'` from server state on page load. In thrown state, no "Write a message" button is rendered (only exists in idle state, lines 134–143). The MessageEditor and throw button are inaccessible through the UI.

6. **Receive quota**: enforced at the match-bottle edge function level (edge function assigns `receiver_id` only to users where `has_received = false` for today). This is in the edge function, not testable from this code, but the DB schema and daily_quotas table support it correctly.

**Verdict**: PASS. All three quota guards confirmed. UI blocks second send. 429 response body matches exact acceptance criterion.

---

### US-007: Countdown Timer to Next Bottle — PASS

**Evidence examined**: `apps/web/components/shared/DailyTimer.tsx`

**Pass criteria verified (static)**:

1. **Targets UTC midnight**: `getTimeUntilMidnightUTC()` (lines 12–20): `midnight.setUTCHours(24, 0, 0, 0)` sets the target to the next UTC midnight. `diff = midnight.getTime() - now.getTime()`. This is correct — it always targets UTC midnight regardless of the user's local timezone.

2. **Real-time countdown**: `useEffect` (lines 32–37): `setInterval` fires every 1000ms, updating the time state. The display will count down in real time.

3. **No NaN path**: `hours: Math.floor(diff / (1000 * 60 * 60))` — if `diff` is always positive (which it will be since we're computing time until next midnight), no NaN can result. Edge case at midnight itself: diff would be 0 or very briefly negative for one tick, at which point `Math.floor(0)` = 0 and the timer would show `00:00:00`. The quota reset itself (new date row) happens at UTC midnight so the state machine would transition correctly on the next `getStatus` poll after midnight.

4. **Human-readable label**: timer renders "Next bottle in" label (line 44) above the HH:MM:SS display (line 46–51). Not a raw UTC timestamp.

5. **Null on first render (SSR hydration guard)**: `time` is initialized as `null` (line 30), set in `useEffect` (client-only). Returns `null` until client-side hydration. This prevents SSR mismatch.

6. **Navigation persistence**: timer is a pure countdown from current time to UTC midnight. On re-mount after navigation, it recalculates from `Date.now()` — always accurate, never frozen.

**Defect DEF-003** (minor): At exactly UTC midnight, the timer will briefly show `00:00:00` before the quota resets and the home page transitions back to idle. This is a 1-tick visual artifact. The home page state machine relies on `todayStatus.quota.has_sent` from the API — the transition back to idle requires a re-fetch of the status query after midnight. RTK Query will refetch on the next navigation or when the cache invalidates. There is no automatic refetch trigger at UTC midnight. A user who sits on the home page over midnight will see the timer hit 00:00:00 but the home page may not immediately revert to idle state without a page action. This is a known edge case worth tracking.

**Verdict**: PASS. DEF-003 flagged as minor midnight-transition edge case.

---

### US-008: Report Abusive Message — PARTIAL

**Evidence examined**: `apps/web/components/bottle/ReceivedBottle.tsx`, `apps/web/app/api/bottles/[id]/report/route.ts`, `supabase/migrations/002_rls_policies.sql`, `supabase/migrations/005_rls_column_restriction.sql`

**Pass criteria verified (static)**:

1. **Report action accessible**: `ReceivedBottle.tsx` lines 70–80: a Flag icon button is present on every received bottle card. `aria-label="Report this bottle"`. Accessible and visible.

2. **Idempotent**: button is `disabled` when `bottle.is_reported === true` (line 73). The route does `.update({ is_reported: true }).eq('id', id).eq('receiver_id', user.id)` — if already true, the UPDATE is a no-op at the DB level. No duplicate flag or error.

3. **Only receiver can report**: RLS policy `"bottles: receiver marks read or reported"` enforces `auth.uid() = receiver_id` at row level. Column-level grant (migration 005) restricts UPDATE to `is_read, read_at, is_reported` — the report route only writes `is_reported`, which is in the granted set.

4. **Soft flag only**: route returns `{ ok: true }` on success, no auto-action taken. `is_reported` flag is set for admin review.

5. **Bottle not deleted on report**: route is a PATCH (`UPDATE`), not a DELETE. Bottle remains in the receiver's inbox; the flag icon becomes disabled.

6. **UUID validation**: report route lines 32–34: UUID regex validation before DB call. Path traversal and injection attempts return 400.

**What is NOT implemented**:

- **No UI confirmation / toast on report**: `ReceivedBottle.tsx` has no success state after `reportBottle` resolves. The button becomes disabled (because `bottle.is_reported` flips in the cache via RTK invalidation on refetch), but there is no toast, snackbar, or copy change confirming the report was received. This is a UX gap — users get no confirmation that their report was submitted.

- **No admin review UI**: As documented in the June-11 PM assessment, there is no admin-facing view of reported bottles. This is a safety risk before real user data accumulates.

**Defect DEF-004** (medium): No in-app feedback to the user after reporting a bottle. The button becomes disabled but no explicit "Report submitted" or "Thank you for reporting" message appears. Per the acceptance criteria: "the UI acknowledges the report (toast, state change, or copy update)." This criterion is not met.

**Verdict**: PARTIAL. API and RLS correct. DEF-004 (no report confirmation UX) is a medium defect against the acceptance criteria.

---

### US-009: WhatsApp Opt-in Settings — BLOCKED / CANCELLED

**Context**: WhatsApp was removed from the product entirely (Kushal Session 7). The settings page was rebuilt by Souryadeep (Session 1) as a three-section informational page (Privacy, About, Session). It has no notification controls, no phone number input, and no opt-in/out toggle.

**Verdict**: BLOCKED / CANCELLED. US-009 is formally invalid. The settings page has no WhatsApp UI because WhatsApp does not exist in the product. Per Arpan June-11 assessment, US-009 should be retired or rewritten for a future notification channel.

---

### Defect Register

| ID | US | Severity | Description | Owner | Status |
|----|-----|----------|-------------|-------|--------|
| DEF-001 | US-002 | Minor | `prefers-reduced-motion` not explicitly handled; Framer Motion animations may play for users with motion preference set. `MotionConfig reducedMotion="user"` not confirmed at root layout. | Ishan | Open |
| DEF-002 | US-003 | Minor | `MessageEditor` textarea does not hard-cap input at 1000 chars — counter goes negative/red but input is not truncated. Server enforces 400. Acceptance criterion says "capped at 1000 chars client-side." | Ishan | Open |
| DEF-003 | US-007 | Minor | No automatic state transition back to idle at UTC midnight for users who keep the app open over the reset boundary. RTK Query does not refetch status at midnight without a user action. | Ishan / Kushal | Open |
| DEF-004 | US-008 | Medium | No in-app confirmation (toast/copy/state) shown to user after reporting a bottle. Button becomes disabled but user receives no explicit acknowledgment. Acceptance criterion: "UI acknowledges the report." | Ishan | Open |

---

### Summary

**PASS (confirmed by static analysis)**: US-002, US-003, US-005, US-006, US-007

**PARTIAL (code correct, specific criteria gap)**: US-001 (email delivery unverifiable), US-008 (no report confirmation UX)

**REFRAMED / PASS (WhatsApp replaced by in-app Realtime)**: US-004

**BLOCKED / CANCELLED**: US-009

**Total defects found**: 4 (3 minor, 1 medium)

**Beta launch gate**: DEF-004 (medium) should be fixed before beta — reporting is a safety feature and users must receive confirmation their report was submitted. DEF-001 should also be fixed as it is an accessibility compliance issue (WCAG non-text contrast and motion).

DEF-002 and DEF-003 are acceptable for beta with tracking.

**NOTE for human QA tester**: This run was conducted entirely via static code analysis. The following items require a live browser/curl session to confirm:
1. US-001: actual email delivery (magic link arrives within 60 seconds, redirects to /home)
2. US-003: throw animation plays end-to-end in browser
3. US-004: Supabase Realtime fires correctly when match-bottle edge function assigns receiver_id
4. US-006: direct API call with session cookie returns exact 429 body
5. US-007: timer transitions correctly at UTC midnight boundary
6. US-008: confirm is_reported = true in Supabase DB after API call

---

## 2026-06-11 — Notification Strategy Decision: WhatsApp Replacement

**Author**: Arpan (Nagoya)
**Context**: WhatsApp was removed from the product (Kushal Session 7, Ishan Session 6). The in-app Realtime listener (RealtimeBottleListener) and ReceivedBanner only fire when the app is open. There is currently no pull-back notification path for users who have closed the browser or backgrounded the tab. This breaks the core retention loop: "stranger gets notified, opens app, reads message."

---

### Decision

**Phase 1 (beta, ship now): Email notification via Supabase + Resend**

**Phase 2 (post-beta, when user base justifies it): Web Push as an opt-in upgrade layered on top of email**

Email is the correct choice for Phase 1. Here is the reasoning.

---

### Why email wins Phase 1

**Friction is zero.** Every user already provided their email to receive the magic link. We have 100% coverage on day 0. No new prompt, no permission grant, no extra sign-up step. Web push requires a browser permission prompt that historically converts at 40–55% — we would immediately exclude up to half our beta cohort from ever getting pull-back notifications.

**Philosophy fit is actually strong.** The product's core design principle is "notification respect — only for bottle received, never spam." Email at once-per-bottle, mystery-forward subject line, zero marketing — this is respectful. The concern that "email can sit unread" is real but it is not a disqualifying flaw; it is honest. A message in a bottle is patient. An email waiting in your inbox is not a worse metaphor than a WhatsApp badge — it is a different register of the same thing. "Something washed up for you" in the subject line has narrative power that a push notification blank-title cannot replicate.

**Infrastructure lift is minimal.** Supabase already has an SMTP integration layer. Resend's free tier (3,000 emails/month) covers the entire beta user pool at 1 email/user/day. The existing `send-whatsapp` edge function pattern is directly reusable — swap the WhatsApp API call for a Resend API call, same trigger, same architecture. Kushal can ship this in a single session.

**No iOS exclusion.** Web push on iOS requires Safari 16.4+ and the user to have added the PWA to their home screen before the push subscription can be registered. Even among the iOS users who have the right Safari version, the add-to-home-screen requirement creates a two-step opt-in that compounds the permission-grant friction problem. For a small beta group on diverse devices, this is an unacceptable exclusion surface. Email reaches everyone.

**Why not skip Phase 1 and go straight to Web Push?** Because we are in closed beta with an invited user group. These are engaged, curious testers who will tolerate a slightly lower-urgency notification format. The goal of Phase 1 is to close the retention gap (users who close the app and never know they received a bottle), not to replicate the instant-buzz feel of WhatsApp. Email closes that gap. Web push can add urgency later when we have enough users to A/B test conversion lift.

---

### Phase 2 framing: Web Push as opt-in upgrade

Once we are past beta and targeting growth, Web Push is the right next step because:
- On Android and desktop Chrome/Firefox, it works without the PWA add-to-home-screen requirement
- It restores the near-instant "buzz" feel that WhatsApp had
- It signals product maturity to users (a PWA that sends push notifications feels like a real app)
- It should be layered on top of email, not replace it — users who grant push get push, users who do not continue to get email

The Phase 2 settings UI would add a single toggle: "Also notify me via push notifications (faster delivery)." Email remains the silent baseline.

---

### Product rules — send / no-send contract

These rules apply to both Phase 1 (email) and Phase 2 (push). They are the direct successor to the "notification respect" principle from the original WhatsApp spec.

**Send notification when:**
- A bottle is matched to the receiver and `receiver_id` is assigned (i.e., the match-bottle edge function runs successfully)
- This is the only notification trigger. One per bottle received. One bottle per day maximum. Therefore: maximum one notification per user per day.

**Do NOT send notification when:**
- The bottle is queued ("still sailing") — no match has happened yet. Sending a "your bottle is sailing" notification would be premature and confusing. Silence is correct here. When the match eventually fires (hourly retry cron), the standard notification sends then.
- The user already has the app open (in-app Realtime + banner already handles this). To avoid duplicate notification when the user is active, check last_active on the profile (or use a Supabase presence flag). If last_active is within 5 minutes, skip the email. This avoids the jarring "you got an email about something you already saw in-app" moment.
- The user has explicitly opted out. An opt-out flag (`email_notifications_enabled BOOLEAN DEFAULT TRUE`) must be added to the profiles table. This is a data change Kushal must make alongside implementing the email function.
- A previous notification for the same bottle has already been sent (idempotent check on the notification log — see below).

**Rate cap:**
- Absolute maximum: 1 notification per user per day. The daily quota system already prevents a user from receiving more than one bottle per day, so this constraint is automatically satisfied. But the notification layer should have its own idempotency guard (do not rely solely on the quota system).

**Retry behavior:**
- If email delivery fails (Resend API error), retry once after 60 seconds. If the second attempt fails, log the failure and do not retry again. The user will see the bottle next time they open the app via Realtime. Silent failure is better than spam retries.

---

### User-facing copy

**Email (Phase 1)**

Subject: `Something washed up for you`

Body (plain text, mobile-optimized, no images required):

```
A glass bottle found its way to you.

Someone, somewhere, wrote you a message. You don't know who.
They don't know it reached you yet.

Open it here: [link to /inbox]

—

glassbottles
One bottle. One stranger. Every day.

To stop receiving these emails, visit your settings: [unsubscribe link]
```

Design notes for Souryadeep / Ishan when building the email template:
- HTML version should use the ocean-deep background (#0A1628), sand text (#F7E7CE), and a single coral CTA button ("Open your bottle")
- No images in the email body — email clients are hostile to large images, and text-only preserves the mystery tone better
- No sender name, no preview of the message content, no metadata. The email should reveal nothing except that a bottle arrived.
- The subject line "Something washed up for you" must not be changed. It is the mystery hook. Do not add emoji to the subject — deliverability tools penalize emoji-heavy subject lines and it undercuts the tone.
- From address: `bottles@glassbottles.app` (not noreply — "noreply" is hostile; "bottles" is on-brand)
- From name: `glassbottles`

**Web Push (Phase 2)**

Title: `A bottle arrived`
Body: `Someone left you a message. Open it before the tide turns.`
Icon: the bottle SVG (192x192 PNG version, required for push notification display)
Badge: the bottle SVG icon (monochrome, 72x72)
Action button (optional, if browser supports): "Open" → deep-links to /inbox
Tag: `bottle-received` — this ensures if multiple push events queue while offline, only the latest one shows (no badge accumulation for a product that sends max one bottle per day)

---

### Schema change required (Kushal)

Add one column to `profiles`:

```sql
ALTER TABLE public.profiles
  ADD COLUMN email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
```

This is the opt-out flag. Default true — all existing and new users receive email notifications by default. Users can disable in settings.

A corresponding `notification_logs` table is needed for idempotency:

```sql
CREATE TABLE public.notification_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bottle_id   UUID REFERENCES bottles(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'push', 'in_app')),
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bottle_id, user_id, channel)
);
```

The UNIQUE constraint on (bottle_id, user_id, channel) is the idempotency guard. Attempting to log a second notification for the same bottle+user+channel fails at DB level — the edge function treats this as a skip.

RLS on `notification_logs`: no client access. Service role only. Same pattern as the existing `whatsapp_logs` table.

---

### Settings page change required (US-009 rewrite)

US-009 ("opt in/out of WhatsApp notifications") is formally retired as originally specced. It is replaced by:

**US-009-R: User can manage email notification preferences in settings**

Acceptance criteria:
- Settings page shows a toggle labeled "Email me when a bottle arrives" (default: on)
- Toggling off calls PATCH /api/profile with `{ email_notifications_enabled: false }`
- Toggling on calls PATCH /api/profile with `{ email_notifications_enabled: true }`
- The current state of the toggle reflects the value in `profiles.email_notifications_enabled`
- An unsubscribe link in every email also sets this to false (must be handled via a separate unauthenticated route or Supabase webhook — Kushal to spec)

This is a small addition to Souryadeep's rebuilt settings page (three-section layout: Privacy, About, Session). The notification toggle belongs in the Privacy section.

---

### Analytics schema update

The `whatsapp_opted_in` and `whatsapp_opted_out` events defined in the 2026-06-10 analytics schema are retired. Replace with:

```ts
// Event: email_notifications_toggled
{
  event: 'email_notifications_toggled',
  properties: {
    enabled: boolean   // true = opted in, false = opted out
  }
}
```

Update `apps/web/lib/analytics.ts` to remove the WhatsApp event types and add this event type. Manikant to implement the call site when Ishan builds the settings toggle.

---

### Build sequence (handoffs)

1. **Kushal**: Add `email_notifications_enabled` column to profiles (migration 009). Create `notification_logs` table (migration 010). Build `send-email` Supabase Edge Function (replaces `send-whatsapp` pattern — calls Resend API, checks opt-out flag, writes to notification_logs). Wire edge function into match-bottle flow where send-whatsapp was previously invoked. Add Resend API key to env vars.

2. **Ishan / Souryadeep**: Add email notification toggle to settings page (Privacy section). Wire to PATCH /api/profile.

3. **Manikant**: Add `RESEND_API_KEY` to `.env.example` and Vercel secrets reference. Update analytics.ts to replace WhatsApp events with `email_notifications_toggled`. Confirm `FROM` domain `bottles@glassbottles.app` is configured in Resend dashboard (requires DNS records on the glassbottles.app domain).

4. **Arpan**: Update acceptance test plan for US-004 (now "email notification on bottle receipt") and US-009-R (email opt-in/out toggle). Run acceptance test once email is live.

---

### US table update

| US | Story | New Status |
|---|---|---|
| US-004 | Notification on bottle receipt | RESPECCED — email via Resend replaces WhatsApp. Same trigger (match-bottle edge function), new channel. |
| US-009 | WhatsApp opt-in settings | RETIRED → replaced by US-009-R (email notification toggle in settings) |

**HANDOFF → KUSHAL**: Migration 009 (email_notifications_enabled column), Migration 010 (notification_logs table), send-email Edge Function wired to match-bottle. Use Resend. Free tier sufficient for beta. Env var: RESEND_API_KEY. From address: bottles@glassbottles.app.

**HANDOFF → ISHAN**: Add email notification toggle to settings page Privacy section. Default on. Calls PATCH /api/profile { email_notifications_enabled: boolean }. Wire the existing profile RTK Query endpoint.

**HANDOFF → MANIKANT**: Add RESEND_API_KEY to .env.example and Vercel secrets. Update analytics.ts (remove whatsapp events, add email_notifications_toggled). Confirm Resend domain verification for bottles@glassbottles.app.

