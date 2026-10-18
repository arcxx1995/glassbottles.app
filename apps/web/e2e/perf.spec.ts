import { test, type Page } from '@playwright/test'
import { makeUser, signIn } from './helpers'

// Scene-cost probe, not a pass/fail test: PERF=1 pnpm e2e perf --project pixel-5
// Prints FPS and main-thread milliseconds per second for the animated screens
// under a 4× CPU throttle (≈ mid-tier Android). Compare runs before/after a
// change to the ocean/sky scenes.
test.skip(!process.env.PERF, 'set PERF=1 to run the scene-cost probe')

async function sample(page: Page, label: string, during?: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Performance.enable')
  await page.waitForTimeout(1500)
  const read = async () =>
    Object.fromEntries(
      ((await cdp.send('Performance.getMetrics')).metrics as { name: string; value: number }[]).map(
        (m) => [m.name, m.value],
      ),
    )
  const a = await read()
  const fps = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0
        const t0 = performance.now()
        const f = () => (++n, performance.now() - t0 < 4000 ? requestAnimationFrame(f) : resolve(n / 4))
        requestAnimationFrame(f)
      }),
  )
  if (during) await during()
  const framesPerSec = await fps
  const b = await read()
  const secs = b.Timestamp - a.Timestamp
  const per = (k: string) => Math.round(((b[k] - a[k]) * 1000) / secs)
  console.log(
    `[perf] ${label.padEnd(14)} fps=${framesPerSec.toFixed(1).padStart(5)}  task=${per('TaskDuration')}ms/s  script=${per('ScriptDuration')}ms/s  style=${per('RecalcStyleDuration')}ms/s  layout=${per('LayoutDuration')}ms/s`,
  )
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
}

test('scene cost', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await sample(page, 'landing')

  const u = await makeUser('perf')
  await signIn(page, u.email)
  await page.getByLabel('Message to place in your bottle').waitFor()
  await sample(page, 'home idle')
  await sample(page, 'home typing', async () => {
    await page.getByLabel('Message to place in your bottle').pressSequentially(
      'the quick brown fox jumps over the lazy dog again and again',
      { delay: 40 },
    )
  })
  await page.getByRole('button', { name: /Seal & Throw/ }).click()
  await page.getByText('Sent today ✓').waitFor()
  await page.waitForTimeout(2000)
  await sample(page, 'home sailing')
  await page.goto('/inbox')
  await sample(page, 'inbox')
})
