import DodoPayments from 'dodopayments'

/**
 * Dodo Payments (merchant of record) for the Keeper membership.
 * Server-only: API key + webhook key come from env, never the browser.
 *   DODO_PAYMENTS_API_KEY, DODO_PAYMENTS_WEBHOOK_KEY,
 *   DODO_PAYMENTS_ENVIRONMENT = test_mode | live_mode,
 *   DODO_PRODUCT_MONTHLY / _YEARLY / _LIFETIME = product ids.
 */
export function dodo() {
  return new DodoPayments({
    environment:
      process.env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' ? 'live_mode' : 'test_mode',
  })
}

export const KEEPER_PLANS = ['monthly', 'yearly', 'lifetime'] as const
export type KeeperPlan = (typeof KEEPER_PLANS)[number]

export function productFor(plan: KeeperPlan): string | undefined {
  return {
    monthly: process.env.DODO_PRODUCT_MONTHLY,
    yearly: process.env.DODO_PRODUCT_YEARLY,
    lifetime: process.env.DODO_PRODUCT_LIFETIME,
  }[plan]
}

/** Product id → plan; null for anything this app doesn't sell. */
export function planFor(productId: string | null | undefined): KeeperPlan | null {
  if (!productId) return null
  return KEEPER_PLANS.find((p) => productFor(p) === productId) ?? null
}

export const TRIAL_DAYS = 7
