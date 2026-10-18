import { defineConfig, devices } from '@playwright/test'

// End-to-end suite. Runs against a LOCAL Supabase stack (`supabase start`) and
// `next dev` pointed at it — e2e/helpers.ts refuses any non-local Supabase URL,
// because the suite creates users and rewrites quotas. Env it needs:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (from `supabase status -o env`). One worker: specs share one database.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-14', use: { ...devices['iPhone 14'] } },
    { name: 'pixel-5', use: { ...devices['Pixel 5'] } },
  ],
  // A production build, not `next dev`: dev compiles routes on first visit and
  // can full-reload mid-test, which shows up as phantom navigations.
  webServer: {
    command: 'pnpm exec next build && pnpm exec next start -p 3000',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 300_000,
  },
})
