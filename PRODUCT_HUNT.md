# Product Hunt Launch Checklist — glassbottles.app

Anonymous "message in a bottle" web app. Use this to launch on Product Hunt.

## T-minus 1 week

- [ ] **Create/warm up PH account** — comment genuinely on 5–10 other launches so your account isn't brand new on launch day.
- [ ] **Line up a hunter (optional)** — a hunter with followers boosts reach, but self-launching is fine now. If using one, confirm they'll post at 12:01am PT.
- [ ] **Pick launch day** — Tue/Wed/Thu get most traffic; avoid holidays and major tech-news days. Never Mon or weekend.
- [ ] **Draft all copy** (see Assets below) so launch day is copy-paste only.
- [ ] **Notify your list** — email/DM friends, early users, communities. Ask for a comment, not just an upvote (PH weights engagement).
- [ ] **Production sanity pass** — real launch traffic hits `/`, sign-up, throw-a-bottle, receive flow. Load-test the Supabase RPC read paths + Vercel functions.

## Assets to prepare

- [ ] **Name** — `glassbottles`
- [ ] **Tagline** (≤60 chars) — e.g. "Send an anonymous message in a bottle to a stranger"
- [ ] **Description** (short) — what it does + who it's for, no jargon.
- [ ] **Thumbnail/logo** — 240×240, clear at small size.
- [ ] **Gallery images** (min 3, 1270×760) — hero shot of throwing a bottle, the sea/night-sky UI, the receive/reveal moment. First image is the scroll-stopper.
- [ ] **Demo video/GIF (optional but strong)** — 30–60s of throw → drift → receive.
- [ ] **Topics/tags** — Messaging, Social, Anonymous, Fun.
- [ ] **First comment (maker's comment)** — your story: why you built it, what's novel (anonymity, daily quota, the drift). Pin it.
- [ ] **Links** — live URL, X/Twitter, any press kit.
- [ ] Reuse existing `opengraph-image.tsx` art direction for gallery consistency.

## Launch day (12:01am PT)

- [ ] **Publish at 12:01am PT** — full 24h clock working for you.
- [ ] **Post the maker's comment immediately** and pin it.
- [ ] **Fill out product fully** — every field, all gallery slots.
- [ ] **Share everywhere at once** — X, LinkedIn, relevant subreddits/Discords/Slack, your email list. Link directly to the PH page.
- [ ] **Reply to every comment** within minutes all day — this is the #1 ranking lever.
- [ ] **Ask for feedback, not upvotes** — "vote for us" violates PH rules and reads spammy.
- [ ] **Monitor prod** — watch Vercel logs + Supabase for errors/quota abuse under real traffic.

## Post-launch

- [ ] **Thank everyone** who commented/shared.
- [ ] **Add a "Featured on Product Hunt" badge** to the landing page.
- [ ] **Follow new users** — funnel PH signups into retention (the daily-bottle loop).
- [ ] **Write a recap** — results + learnings for next launch.
- [ ] **Capture emails** from interested visitors while attention is high.

## Rules gotchas

- No vote manipulation, no incentivized upvotes, no "upvote me" language.
- One product per launch; don't re-launch same product within 6 months without meaningful changes.
- Team members must disclose they're makers when commenting.
