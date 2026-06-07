# AGENT_LOG_NAGOYA.md — Product Manager

> Nagoya's PRD, sprint log, edge case decisions, and feature priorities.

## Initialization
**Agent**: Nagoya  
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
<!-- Nagoya appends sessions below this line -->

## 2026-06-07 — Sprint 1 Completion Review

**Reviewed by**: Nagoya  
**Status**: Both agents shipped. Integration handoff complete.

### What shipped

**Felix (backend):**
- 4 DB migrations: schema, RLS, cron cleanup, race condition fix (UNIQUE constraint on sender_id+day_key)
- 7 API routes: send, status, received, read, report, profile, whatsapp/register
- 3 Supabase clients: browser, server (SSR-safe), service role (admin ops only)
- WhatsApp Cloud API client with 1+1 retry

**Bella (frontend):**
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

### Open issues Nagoya must track

1. **RLS UPDATE over-permission** (Felix flagged): receiver can update ALL columns on bottles table, not just is_read/is_reported/read_at. Security hole. Fix before prod.
2. **WhatsApp OTP skipped** (Felix flagged): whatsapp_verified = true on save, no OTP. v1 accepted. Block v2 launch without real verification.
3. **whatsapp_number masking in UI** (Felix flagged): settings shows raw number in input. Bella to mask as ••••1234 in v2 to align with "never in client state" principle.
4. **RTK Query passes userId param** to /api/bottles/status — route ignores it (uses session). Low priority clean-up.

### Nagoya verdict

Core loop is shippable for closed beta: sign up → throw bottle → get WhatsApp → read → report. All 9 US covered. Race condition fixed atomically. No sender identity leak at SELECT level. Ship to 100 beta users; watch throw rate and read rate first.

---

## 2026-06-07 — Sprint Status Review + Next Build Plan

**Reviewed by**: Nagoya

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
| Sprint 4 — Polish + Safety | 🟡 Partial | report ✅, skeletons ✅, error.tsx ✅ — Cherry pass ❌, Khasi review ❌ |
| Sprint 5 — Launch Prep | ❌ Not started | acceptance test, Vercel Analytics, final deploy |

### What's blocking beta launch (priority order)

**P0 — Security**
1. **RLS over-permission**: receiver UPDATE policy covers ALL columns, not just `is_read`, `is_reported`, `read_at`. Felix must scope to those 3 columns. See migration 005 — confirm it closes the gap. → **Assign: Felix**

**P1 — Quality gate**
2. **Khasi full review pass**: no PR to main has been reviewed. Must happen before any real user data enters. → **Assign: Khasi**

**P2 — Visual polish (Cherry)**
3. Cherry has zero logged design decisions. The design tokens are correct (implemented by Bella). Cherry needs to audit the live preview and log approval or change requests per component. → **Assign: Cherry**

**P3 — Launch prep**
4. Vercel Analytics install + uptime monitor (UptimeRobot or Vercel built-in). → **Assign: Shiv**
5. Acceptance test all US-001 to US-009 against staging. → **Assign: Nagoya + QA**

### Deferred to v2 (not blocking beta)
- WhatsApp OTP verification (currently whatsapp_verified = true on save, no OTP)
- Content moderation / profanity filter on message insert (Edge Function stub exists, logic TBD)
- "X bottles in the ocean right now" ambient social proof counter
- Audio/image bottle types (Supabase Storage ready, no UI)

### KPI instrumentation gaps (fix before beta read-out)
- No event tracking wired (throw rate, read rate, WhatsApp opt-in rate are unobservable)
- Decision: use Vercel Analytics for page views + custom `track()` calls for throw/read events
- Nagoya to define event schema before Shiv instruments

