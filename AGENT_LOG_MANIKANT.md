# AGENT_LOG_MANIKANT.md — DevOps Engineer

> Manikant's decisions on CI/CD, Vercel, GitHub Actions, and infra.

## Initialization
**Agent**: Manikant  
**Role**: DevOps Engineer  
**First Task**: pnpm monorepo init, GitHub Actions CI, Vercel project setup

### Infrastructure Status
| Component | Status |
|---|---|
| pnpm workspaces | 🔲 Pending |
| GitHub Actions CI | 🔲 Pending |
| GitHub Actions Deploy | 🔲 Pending |
| Vercel project linked | 🔲 Pending |
| Supabase CLI local | 🔲 Pending |
| .env.example | 🔲 Pending |

---
<!-- Manikant appends sessions below this line -->

## [2026-06-07] Session 1
**Agent**: Manikant
**Task**: Sprint 0 — Monorepo scaffold, CI/CD, env config, dashboard
**Files Changed**:
- package.json (root — pnpm workspaces, scripts)
- pnpm-workspace.yaml
- .gitignore
- .env.example (all required vars)
- apps/web/package.json
- apps/web/next.config.ts
- apps/web/tsconfig.json (strict mode)
- apps/web/tailwind.config.ts (Souryadeep's design tokens)
- apps/web/postcss.config.js
- apps/web/.eslintrc.json
- .github/workflows/ci.yml (lint + typecheck + test on PR)
- .github/workflows/deploy.yml (Vercel prod deploy on push to main)
- apps/dashboard/package.json
- apps/dashboard/server.mjs (Express + SSE + Claude API proxy)
- apps/dashboard/public/index.html (agent monitoring dashboard)
- ~/.claude/settings.json (added Write(*), Edit(*) to global allowlist)

**Decisions Made**:
- pnpm 9.x with workspaces — monorepo root scripts delegate to apps via -r flag
- ci.yml uses --frozen-lockfile — prevents lockfile drift in CI
- deploy.yml passes NEXT_PUBLIC_* vars at build time via secrets
- Dashboard runs on port 3333, separate from main app (port 3000)
- Dashboard uses SSE (not WebSocket) for log streaming — simpler, no ws dependency
- Claude API key loaded from env (ANTHROPIC_API_KEY) — not committed

**Open Questions**:
- Vercel project ID + org ID need to be added to GitHub Secrets before deploy.yml works
- Supabase project ref needed for supabase CLI config — Kushal to provide
- Should dashboard be in pnpm workspace or standalone? Currently standalone (no workspace entry)

**Infrastructure Status**:
| Component | Status |
|---|---|
| pnpm workspaces | ✅ Done |
| GitHub Actions CI | ✅ Done |
| GitHub Actions Deploy | ✅ Done |
| Vercel project linked | 🔲 Needs secrets in GitHub |
| Supabase CLI local | 🔲 Needs project ref |
| .env.example | ✅ Done |
| Agent dashboard | ✅ Done |

**HANDOFF →**: Kushal: supabase/config.toml needs project ref. Run `supabase link --project-ref <ref>` to link local CLI to remote project.

---

## [2026-06-07] Session 2
**Agent**: Manikant
**Tasks**: Sprint 4 — Production deploy config + Vercel Analytics/Speed Insights. Sprint 5 — Health check route, PR preview deployments, env hygiene.

### Files Created
- `apps/web/vercel.json` — framework: nextjs, installCommand: pnpm install --frozen-lockfile, buildCommand: pnpm build, outputDirectory: .next
- `apps/web/.vercelignore` — excludes node_modules, .next, test files (*.test.ts/tsx, *.spec.ts/tsx, coverage)
- `apps/web/app/api/health/route.ts` — Edge runtime GET handler returning `{ status: "ok", timestamp: ISO }` with HTTP 200

### Files Modified
- `apps/web/package.json` — added `@vercel/analytics@^1.3.1` and `@vercel/speed-insights@^1.0.12` to dependencies
- `apps/web/app/layout.tsx` — imported `Analytics` from `@vercel/analytics/react` and `SpeedInsights` from `@vercel/speed-insights/next`; both rendered inside `<body>` after `<ReduxProvider>/<AuthProvider>` tree
- `.env.example` — added `NEXT_PUBLIC_VERCEL_ANALYTICS_ID=` under Vercel block
- `.github/workflows/deploy.yml` — split single deploy job into two conditional jobs: `deploy-preview` (runs on pull_request, no --prod flag, github-comment: true) and `deploy-production` (runs on push to main, --prod flag); both use `amondnet/vercel-action@v25`

### Decisions Made
- Health check route uses `export const runtime = 'edge'` — zero cold-start latency, no DB dependency, suitable for uptime monitors hitting it every 30s
- `@vercel/analytics` uses the React component pattern (`<Analytics />`) rather than the script injection pattern — compatible with Next.js 14 App Router
- `@vercel/speed-insights` uses `<SpeedInsights />` from the `/next` subpath — Next.js-optimised build, deferred loading
- Both observability components placed after the app tree inside `<body>` — they are non-blocking and do not affect render
- PR preview job omits `vercel-args: '--prod'` — this is the correct way to get a Vercel preview URL instead of promoting to production
- `github-comment: true` on preview step — amondnet/vercel-action will post the preview URL as a PR comment automatically; no injection risk because it is a boolean config flag, not a shell string
- deploy.yml uses only `secrets.*` and static strings in all `run:` steps — no untrusted GitHub context values (`github.event.*`, `github.head_ref`, commit messages) appear in any shell command; security audit passed

### Required GitHub Secrets Reference
Add these in: GitHub repo → Settings → Secrets and variables → Actions

| Secret name | Purpose |
|---|---|
| `VERCEL_TOKEN` | Vercel personal access token for deploy |
| `VERCEL_ORG_ID` | Vercel team/org ID (from vercel.com team settings) |
| `VERCEL_PROJECT_ID` | Vercel project ID (from project settings) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public, passed at build time) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public, passed at build time) |
| `NEXT_PUBLIC_APP_URL` | Production URL e.g. https://glassbottles.app |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only, never in NEXT_PUBLIC_*) |
| `WHATSAPP_API_TOKEN` | Meta WhatsApp Cloud API bearer token |
| `WHATSAPP_PHONE_ID` | WhatsApp Cloud API phone number ID |

### Infrastructure Status
| Component | Status |
|---|---|
| pnpm workspaces | Done |
| GitHub Actions CI | Done |
| GitHub Actions Deploy (prod) | Done |
| GitHub Actions Deploy (PR preview) | Done |
| Vercel project linked | Needs secrets added to GitHub (see table above) |
| Supabase CLI local | Needs project ref from Kushal |
| .env.example | Done |
| Agent dashboard | Done |
| vercel.json (apps/web) | Done |
| .vercelignore (apps/web) | Done |
| @vercel/analytics wired | Done |
| @vercel/speed-insights wired | Done |
| Health check route /api/health | Done |
| NEXT_PUBLIC_VERCEL_ANALYTICS_ID in .env.example | Done |

**Sprint 4**: Complete
**Sprint 5**: Complete
