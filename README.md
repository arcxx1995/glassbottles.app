<div align="center">

# 🫙 glassbottles

### One bottle. One stranger. Every day.

*A quiet anti-social network. Write a message, cast it into the sea, and an hour later it drifts to a random stranger somewhere in the world. No replies. No profiles. No feed. No algorithm deciding who matters.*

</div>

---

```
            ┌──────────────────────────────────────────┐
            │  glassbottles                  Sent ✓     │
            │                                           │
            │            ·  ✦   .    ·   ☾   ·          │
            │         ·      .    Your bottle           │
            │              awaits  ·      ✦   .         │
            │                                           │
            │   Write something for a stranger.         │
            │      They won't know it's you.            │
            │                                     ╭╴🫙   │
            │   ╭───────────────────────────────╮ │     │
            │   │  Type your message…           │ │     │
            │   │                               │ │     │
            │   ╰───────────────────────────────╯       │
            │                                           │
            │  ≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈  │
            │  ≈≈≈≈ 🍾 ≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈ ≈≈≈≈≈≈≈≈≈≈≈≈≈≈  │
            │  ≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈ 🍾 ≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈  │
            │  ≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈  │
            │        2 bottles drifting through         │
            │           the ocean, waiting…            │
            │        ⏲  next bottle in 14:32:07         │
            │                                           │
            ├──────────────────────────────────────────┤
            │     ⚓             ✉            ⚙          │
            │   Bottle        Inbox      Settings       │
            └──────────────────────────────────────────┘
```

---

## Why this exists

Every social platform optimises for engagement: more posts, more replies, more dopamine, more time-on-app. glassbottles optimises for the opposite — **scarcity and serendipity**.

- **One bottle per day.** You get a single message to send. That's it. No infinite scroll, no posting spree.
- **No replies.** You will never have a conversation. A bottle is a one-way message to a stranger you'll never meet.
- **No profiles, no followers, no metrics.** Nobody can be "big" here. There is nothing to perform for.
- **Anonymity is absolute.** The sender and receiver of a bottle can *never* learn each other's identity — it is enforced at the database layer, not just hidden in the UI.
- **It makes you wait.** A thrown bottle floats in the sea for **at least an hour** before it's found — even if a perfect match exists the instant you throw it. The waiting *is* the feature. A message in a bottle that's received instantly isn't a message in a bottle.

It's a place to say the thing you can't say to the people who know you — *"I finally told my sister what I'd been meaning to say for three years. It went okay."* — and trust the ocean to carry it to someone who needed to read it.

---

## How it works (the user's journey)

1. **Sign in** with Google or email + password (Supabase Auth).
2. On the home screen, the bottle is tethered to a compose box, bobbing on the sea. You **write one message** and throw it.
3. The bottle drops into the sea and **drifts** — visibly floating, counted in *"bottles adrift right now"* on the landing page.
4. **It cannot be found for at least one hour**, no matter how many people are online.
5. After ~1 hour, the matcher assigns the bottle to a **random eligible stranger** (someone who hasn't received a bottle on *their* local day). At that moment:
   - the receiver gets an **email** (branded, via Resend) and an in-app notification,
   - **your** bottle vanishes from your sea and you get a quiet *"delivered"* signal,
   - the message lands in the receiver's **Inbox**.
6. Tomorrow (measured at *your* local midnight), your daily bottle refills and you can throw again.

You can throw exactly **one bottle per day**, and receive at most **one bottle per day**.

---

## Tech stack

| Layer | Choice |
|---|---|
| **Framework** | Next.js 14 (App Router, React 18, TypeScript) |
| **Styling** | Tailwind CSS 3, custom ocean / night-sky design system |
| **Animation** | Framer Motion (the sea, the throw, the wiggling bottle, banners) |
| **State / data** | Redux Toolkit + RTK Query |
| **Backend** | Supabase — Postgres, Auth, Realtime, Edge Functions, pg_cron |
| **Auth** | Supabase Auth (Google OAuth + email/password); middleware verifies JWTs locally via `getClaims()` (ES256) |
| **Email** | Resend (SMTP transport + branded HTML templates) |
| **Hosting** | Vercel (Fluid Compute), custom domain `glassbottles.app` |
| **Monorepo** | pnpm workspaces (`apps/web`, `apps/dashboard`) |
| **Tooling** | TypeScript 5.5, ESLint, Vitest, `@vercel/analytics` + `speed-insights` |

---

## Architecture

### Reads go straight to Postgres, not through Vercel
Client reads (today's status, received bottles, ambient counts) are **SECURITY DEFINER Postgres RPCs** called directly from the browser via `supabase.rpc(...)` in RTK Query `queryFn`s — **zero Vercel Function compute**. This was a deliberate cost decision: per-tab polling against Vercel `/api/*` routes once caused runaway Fluid usage. **Project rule:** never give an RTK Query hook a `pollingInterval` whose endpoint hits a Vercel route; freshness comes from Supabase-direct RPCs + Realtime, and any poll must pair with `skipPollingIfUnfocused: true`.

### Live updates: Realtime broadcast, with a poll as a safety net
A Postgres trigger (`notify_bottle_matched`) fires a **private Realtime broadcast** to the affected user's `user:<uuid>` topic carrying only a `bottle_id` (no identities). `RealtimeBottleListener` invalidates the relevant RTK Query cache on receipt. Realtime is only a *refresh hint* — every banner/state derives from server truth and also reconciles via a slow focused-tab poll (≤30s) or navigation, so a missed socket event can never *lose* a notification.

### The matcher — one atomic function, gated by time
`match_bottle()` is the single transactional chokepoint for all matching (`SELECT … FOR UPDATE`, random eligible receiver, receiver-quota write — all in one transaction). It refuses to match any bottle younger than **one hour** (the "1 hour adrift" rule). Matching is driven by a **pg_cron** retry job every 15 minutes, so a bottle is found on the first tick after it crosses the hour (~1h00–1h15). There is no instant / send-time match.

### Per-user local day
"One bottle per day" and the daily reset are measured at **each user's local midnight**, derived from a stored IANA timezone on their profile (`user_local_date()`), not a global UTC day.

### Live public counters (event-driven)
The landing page's *"bottles adrift right now"* and *"bottles in the sea till now"* read a single cached `public_stats` row, kept live by **DB triggers** (not per-visitor `COUNT(*)` scans, not crons):
- `total_count` — `+1` on every throw, never decremented → cumulative-ever / monotonic.
- `adrift_count` — an exact delta trigger over `received_at IS NULL AND is_stale = FALSE` (throw `+1`, match `−1`, stale `−1`, delete `−1`).

O(1) per event, served from one row → scales to unlimited landing traffic.

---

## Anonymity model (enforced in the database)

Anonymity is not a UI convenience — it's structural:

- Client read RPCs return **only** anonymity-safe columns. `sender_id` / `receiver_id` never leave the database.
- Realtime payloads carry only a `bottle_id`; `realtime.messages` RLS restricts each client to its own `user:<uuid>` topic.
- Row-Level Security scopes every row to its sender or receiver; column-level grants stop a receiver from rewriting anything but `is_read` / `is_reported`.
- Server-only secrets: the service-role key lives exclusively in API route handlers and Edge Functions, never in a `'use client'` bundle.

---

## Project structure

```
glassbottles/
├─ apps/
│  ├─ web/                      # the Next.js app
│  │  ├─ app/
│  │  │  ├─ (app)/              # authed: home, inbox, settings (+ AppShell, BottomNav)
│  │  │  ├─ (auth)/             # sign-in, sign-up, forgot/reset-password
│  │  │  ├─ auth/callback/      # single PKCE code-exchange landing
│  │  │  ├─ api/                # bottles/send, account/delete, profile, whatsapp…
│  │  │  └─ page.tsx            # landing page (hero, live counters, example bottle)
│  │  ├─ components/            # bottle/, layout/, shared/ (SailingSea, BottleCanvas…)
│  │  ├─ store/                 # Redux slices + RTK Query api (bottleApi, authApi)
│  │  ├─ lib/supabase/          # browser / server / service clients
│  │  └─ middleware.ts          # auth gate via getClaims()
│  └─ dashboard/                # internal ops dashboard
├─ supabase/
│  ├─ migrations/               # 001 … 023 (schema, RLS, RPCs, matcher, cron, stats)
│  ├─ functions/                # Edge Functions (match-bottle, notify-receiver)
│  ├─ templates/                # branded auth emails (confirmation, recovery, email-change)
│  └─ config.toml               # local Supabase config (do NOT `config push` — see below)
└─ pnpm-workspace.yaml
```

---

## Local development

```bash
pnpm install                 # install workspace deps (Node ≥20, pnpm ≥9)
pnpm dev                     # run the web app (apps/web) on :3000
pnpm typecheck               # tsc across the workspace
pnpm lint                    # eslint across the workspace
pnpm test                    # vitest
```

Environment: copy `.env.example` → `.env` / `apps/web/.env.local` and fill the Supabase URL + anon key, the service-role key (server-only), and the Resend API key.

---

## Deployment

- **Frontend** deploys to **Vercel** on push to `main` (production domain `glassbottles.app`; `test.glassbottles.app` for staging).
- **Database changes** apply with `supabase db push` (migrations only — safe).
- ⚠️ **Never run `supabase config push`.** `config.toml` holds local-dev auth values (`site_url = http://127.0.0.1:3000`, a partial redirect list); pushing it would overwrite the production Supabase Auth config and break login for everyone. Set production email templates / URLs in the Supabase **dashboard**.
- Auth confirmation / recovery links route through `/auth/callback`; the production redirect allow-list must include `https://glassbottles.app/auth/callback`.

---

## A note on the name

A glass bottle is fragile, transparent, and carries exactly one message. You throw it without knowing where it lands, and you trust the current. That's the whole app.

<div align="center">

*Built with intention. No feed, no metrics, no noise — just one bottle, one stranger, every day.*

</div>
