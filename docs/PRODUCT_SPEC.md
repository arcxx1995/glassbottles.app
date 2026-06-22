# glassbottles.app — Product Specification

> **Status:** Living document — direction agreed, pre-MVP.
> **Last updated:** 2026-06-22
> **Owner:** arcxx1995

---

## 1. Positioning

**The anti-social-media for lonely & neurodivergent minds.**

Slow, low-pressure connection. No followers, no metrics, no feed, no doomscroll. The
daily anonymous bottle is the **acquisition wedge**, not the product. The product is a
place that makes lonely, introverted, and neurodivergent (ADHD) people feel *less alone
on a recurring basis* — without the anxiety of normal social apps.

**Target users:** introverts, lonely people, neurodivergent (ADHD) people.

**Thesis:** loneliness epidemic + neurodivergent wellness — two of the strongest
consumer-health investment theses. Comparables: Finch (self-care pet), Slowly (pen-pal /
message-in-bottle, the closest mechanic twin), Replika, Wisdo, 7 Cups.

**Edge:** the bottle ritual is naturally low-pressure — exactly what this audience fails
at on Discord/Instagram. Safety + community trust = the moat, not technology.

---

## 2. Strategic frame

| | |
|---|---|
| **Free tier** | Acquisition engine. Viral, screenshot-able, near-zero cost (Supabase-direct RPC, no Vercel compute). Never paywalled. |
| **Paid tier** | Continuity, identity, and care. People pay to make the conversation *not end*, to belong, and to keep memories. |
| **Moat** | Gentle moderation + safety for vulnerable users. "We made anonymous connection safe." |
| **Cost structure** | Near-zero marginal cost per user — part of the investor story. |

### Free vs Paid split

| Free (acquisition + gamification) | Paid (continuity + depth) |
|---|---|
| 1 bottle/day, Open Sea | Unlimited bottles, choose currents |
| Mood check-in + streaks | Reply / keep-thread (the killer upgrade) |
| Moby Dick events + coins | Unlimited save shelf (free: 3) |
| Save shelf (3) | Throw further (or via coins) |
| Vibe tags | Circles, premium currents, companion prompts |

---

## 3. Architecture principles (carry into every feature)

- **No polling against Vercel `/api/*` routes.** Reads = Supabase-direct `queryFn` (RPC/select).
  Live updates = Supabase Realtime broadcast (primary), polling = slow fallback only with
  `skipPollingIfUnfocused: true`.
- **Atomic, idempotent RPCs** for all state mutations (same pattern as `match_bottle()`,
  `send_bottle()`).
- **Anonymity by default.** Realtime broadcast ships only `bottle_id`, no identity leak
  (migration 015). This is a safety asset — protect it.
- **Scheduled work = Supabase `pg_cron` + Edge Functions**, not Vercel cron — keeps cost
  rule and zero Fluid compute.

---

## 4. Phased roadmap

### Phase 0 — What exists today (pre-MVP / prototype)

- Daily free anonymous bottle: send 1/day, one-shot, matches a stranger after 1h afloat.
- Atomic matcher (`match_bottle()`), per-user local-midnight daily reset.
- Send path on RPC (`send_bottle()`), optimistic quota, no Vercel cold start.
- Realtime broadcast notifications (anonymous), banners derive from server state.
- PWA: web app manifest + iOS home-screen support.

**Verdict:** clever demo, no retention loop, no monetization. Not yet an MVP.

---

### Phase 1 — Retention MVP (0–3 months) · *make it sticky*

**Goal:** prove the daily-return loop. This is the spine everything hangs on.
**Fundable signal:** D1/D7/D30 cohort retention bending the right way.

| Feature | Description | Tech notes |
|---|---|---|
| **Mood check-in** | Daily one-tap mood (weather metaphor: stormy / foggy / calm / sunny). Low friction = ADHD-friendly. Seeds the bottle flow ("Stormy today? Throw a bottle about it"). | RPC write; private history feeds save shelf. |
| **Streaks (ADHD-safe)** | "Days you showed up for yourself," tied to mood check-in (low bar), not bottle-throwing. Auto-forgive 1–2 misses/month (streak freeze). No shame copy, ever. Milestone coin rewards. | DB streak state + grace logic. |
| **"Your bottle was found" push** | The magic moment — someone, somewhere, read your words. Highest-emotion notification in the app. Drives return. | DB trigger → Supabase Edge Function → Web Push. |
| **Web Push (PWA)** | Primary notification channel, free. iOS 16.4+ requires home-screen install — push the install step hard in onboarding. | Store subscription in Supabase; fire from Edge Function. |
| **Reply / keep-thread** *(first paid feature)* | Free bottle = one-shot. Paid: when a bottle resonates, keep talking — stranger becomes pen-pal. #1 willingness-to-pay lever. Thread opens only on **mutual consent** (anti-stalking). | New thread table; consent gate. |
| **Save shelf** | Keep meaningful received bottles on a private "shelf" of glass. Revisit on bad days. Free = 3, Plus = unlimited. Paywalls *memory storage*, not connection. | `saved_bottles` join table. |

---

### Phase 2 — Identity (3–6 months) · *belonging without performance*

| Feature | Description | Tech notes |
|---|---|---|
| **Currents (ambient communities)** | Tagged water bodies = a filter on the match pool + a shared ambient surface. Free → Open Sea (everyone). Paid → choose a current: ADHD, grief, night-owl, just-diagnosed, quiet-wins. | `currents` table; bottle gets `current_id`; add `WHERE current_id = X` to `match_bottle()`. |
| **Ambient surface** | Each current shows live-ish stats: "412 souls adrift here tonight," "1,203 bottles passed through today," a few anonymized floating fragments. Feels populated without exposing anyone. The "others are here, I'm not alone" effect *is* the product for introverts. | Counts via Supabase RPC, **not** Vercel polling. |
| **Vibe tags (routing + consent)** | Not decoration — a routing signal. **Sender intent:** "venting, don't need advice" / "want gentle words" / "fellow ADHDer" / "small win." **Receiver capacity:** "open to heavy stuff today" / "light only right now." Matcher respects both. 8–10 tags max (anti-paralysis). | Tag columns on bottle + user prefs; matcher constraint. Also half the safety layer. |
| **Cosmetics shop** | Bottle glass, wax seals, ocean themes, message paper, stamps. Pure margin (proven by Slowly). À la carte for free users; bundled in paid. | Coin + real-money sink. |
| **Throw further** | Better-match upgrade. Spend coins or Plus perk to: widen pool (cross-current/global), aim into a specific current, or priority placement. In-world: a stronger throw rides a longer current. | Matcher pool modifier; coin sink. |

---

### Phase 3 — Community + Care (6–12 months) · *DAU + brand*

| Feature | Description | Tech notes |
|---|---|---|
| **Daily events — Catch the Moby Dick** | A whale spawns at a random time in a random current/sea for a short window (push: "🐋 Moby surfaced in the Night-Owl current"). FOMO → opens at off-times → DAU lift. Catchers split **coins** (or gentle everyone-who-catches reward — avoid pure leaderboards, they stress this crowd). | Spawn = `pg_cron` writes `events` row; clients learn via Realtime. Catch = atomic `harpoon_event(event_id)` RPC (window check + decrement + credit, idempotent). |
| **Coins (soft currency)** | Earned from events/streaks. Spend on cosmetics, throw-further, extra bottles, currents. Keep sinks in-app first. **Non-cashable, non-transferable** (ToS) — avoids real-money/sweepstakes legal exposure + farming. | Ledger table; race-safe RPCs. |
| **Circles** *(paid)* | Small, slow, 5–8 person bottle-threads around a theme. Intimate, capped, low-pressure — the opposite of a 5,000-person server. | Group thread model. |
| **Companion prompts** *(paid)* | AI-gentle nudges ("rough day? throw a bottle about it"). Supportive, not clinical. Latest Claude with safety guardrails. | LLM in Edge Function. |
| **Gifting subscriptions** | Give a friend connection. Converts well; seasonal spikes. | Stripe gifting flow. |
| **Seasonal events** | "Winter loneliness drive," themed cosmetic drops. | Content/ops. |

---

### Phase 4 — Scale story (12 months+) · *the venture-scale line*

| Feature | Description |
|---|---|
| **Partner-brand rewards** | Coins redeem for real products from partner brands (ADHD/wellness DTC: Finch-adjacent, supplements, journaling, calm-tech). Needs marketplace + partner deals + fraud/redemption control + user volume to sell. Build *after* volume exists. |
| **B2B / "social wellness" seats** | Sell seats to universities, therapists, EAP/HR mental-health benefits. Turns consumer app into venture-scale story. University loneliness programs = real budgets. |
| **Partnerships** | ADHD / mental-health orgs, neurodiversity nonprofits. |

---

## 5. Safety & moderation (cross-cutting — required before launch-scale)

Layered defense, ordered by leverage. This is the **moat and the liability** both.

1. **Consent-based routing (vibe tags).** Prevents most harm *before* it happens — design-level, not policing.
2. **Crisis-keyword detection.** Scan outgoing text for self-harm/crisis signals → never gamify; gently surface region-aware resources. Never block silently; redirect with care. LLM classifier in send path / Edge Function.
3. **Abuse/harassment classifier on send.** Slurs, sexual content, contact-info fishing → soft-block + warn. Filter at send, not after delivery.
4. **One-tap report + block** on every received bottle → quarantine sender → human review queue → strikes → shadowban.
5. **Rate limits + anti-farming.** Keep quota logic tight (idempotent RPCs).
6. **Anonymity by default** (migration 015) — protect it.
7. **No DMs without mutual consent** — kills the stalking vector.
8. **Visible safety + trust copy.** Vulnerable users stay only if safety is *felt*.

> ⚠️ **Real exposure:** minors, self-harm content, and harassment on an anonymous app
> aimed at vulnerable users = genuine legal + ethical risk. Before launch-scale:
> age-gate, a written crisis-response policy, and a human in the moderation loop.
> Do **not** ship pure-anonymous to lonely/ND users without items 2–4 live.

---

## 6. Notification strategy (cross-cutting)

Layered, not one channel:

| Channel | Role | When |
|---|---|---|
| **Web Push** | Primary, free. Owns the home screen (push PWA install in onboarding). | Ambient + all events. DB trigger → Edge Function. |
| **WhatsApp Cloud API** | Retention weapon. 90%+ open rates, personal. Needs opt-in + Meta template approval + per-conversation cost. | Only the highest-emotion events: bottle found, thread reply, about-to-lose-streak. |
| **Email (Resend)** | Cold re-engagement / digest fallback. | Dormant 7d+, or users who never granted push. |

**Decision rule:** emotional + time-sensitive → WhatsApp + Push. Ambient → Push only. Dormant 7d+ → email.

---

## 7. Revenue model (summary)

- **Primary: subscription** — "Tide / Deep Water" membership.
  - Free: 1 bottle/day, one-shot, Open Sea.
  - Plus (~$5.99/mo or $39/yr): unlimited bottles, reply & keep threads, choose currents, save shelf, mood streaks, basic cosmetics.
  - Pro/Patron (~$11.99/mo): all the above + premium currents, companion prompts, gifting, all cosmetics, supporter badge.
- **Secondary:** cosmetic micro-transactions (impulse, free users), gift subscriptions, then B2B seats (year 2+).
- **Avoid:** ads — kills the calm, the brand, and the thesis.

**Benchmark math:** 2–5% free→paid on a wellness consumer app.
500k MAU × 3% × $48/yr ≈ **$720k ARR**. 5M MAU × 4% ≈ **$9.6M ARR**. Cosmetics + B2B on top.

---

## 8. Build-order rationale

Phase 1 first because **retention is everything** — until people return daily on their
own, there is no MVP, only a toy that demos well. The Phase 1 slice
(**mood → streak → "bottle was found" push**) is the cheapest, highest-leverage build and
fits entirely in the existing Supabase RPC + Realtime + PWA stack — no new infra.
