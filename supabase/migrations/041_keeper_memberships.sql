-- Migration 041: Keeper membership (Dodo Payments)
--
-- The bottle stays free. Keeper is an optional membership for beautiful extras,
-- sold through Dodo Payments (merchant of record). This migration is only the
-- entitlement: who is a Keeper, until when.
--
-- One field decides access: memberships.access_until. Everything paid asks
-- is_keeper(uid) = access_until > now().
--   subscription active / renewed      → access_until = next_billing_date
--                                         (a trial reports active with the
--                                         trial end as next_billing_date)
--   past_due / cancelled               → unchanged (runs to the paid end)
--   on_hold / failed / expired / paused → now()
--   lifetime payment                   → 'infinity'; only a full refund ends it
--
-- Writes come only from the Dodo webhook route, as service_role, through
-- apply_dodo_event(). Clients read their own row (RLS) and nothing else.

-- ── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.memberships (
  user_id              UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan                 TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly', 'lifetime')),
  status               TEXT NOT NULL,
  access_until         TIMESTAMPTZ NOT NULL,
  keeper_since         TIMESTAMPTZ NOT NULL DEFAULT now(),
  dodo_customer_id     TEXT,
  dodo_subscription_id TEXT,
  lifetime_payment_id  TEXT,
  last_event_at        TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memberships_subscription_idx
  ON public.memberships (dodo_subscription_id) WHERE dodo_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS memberships_customer_idx
  ON public.memberships (dodo_customer_id) WHERE dodo_customer_id IS NOT NULL;

-- Dodo retries a delivery up to 8 times; webhook-id makes a replay a no-op.
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "memberships: read own" ON public.memberships;
CREATE POLICY "memberships: read own" ON public.memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Legacy default privileges on prod grant ALL; take writes back explicitly.
REVOKE ALL ON public.memberships, public.webhook_events FROM anon, authenticated;
GRANT SELECT ON public.memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships, public.webhook_events TO service_role;

-- ── 2. is_keeper ────────────────────────────────────────────────────────────
-- Internal: called by SECURITY DEFINER RPCs that gate paid features. Not
-- granted to clients — it takes any uid, and a client only needs its own row.
CREATE OR REPLACE FUNCTION public.is_keeper(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = p_uid AND access_until > now()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_keeper(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Founding Keeper spots ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.founding_spots_left()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0, 100 - count(*))::int
  FROM public.memberships
  WHERE plan = 'lifetime' AND access_until = 'infinity';
$$;

REVOKE EXECUTE ON FUNCTION public.founding_spots_left() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.founding_spots_left() TO authenticated, service_role;

-- ── 4. apply_dodo_event ─────────────────────────────────────────────────────
-- One transaction: the webhook_events insert and the membership change commit
-- together, so an event is recorded only once it was applied, and a replay
-- returns 'duplicate' without touching anything.
--
-- p_plan is resolved by the route from the product id (env config), NULL for
-- products this app doesn't sell. Returns:
--   'applied' | 'duplicate' | 'ignored' | 'stale' | 'no_user'
-- 'no_user' is NOT recorded, so a replay from the Dodo dashboard can apply it
-- once the mapping is fixed.
CREATE OR REPLACE FUNCTION public.apply_dodo_event(
  p_event_id TEXT,
  p_type     TEXT,
  p_ts       TIMESTAMPTZ,
  p_data     JSONB,
  p_plan     TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      UUID;
  v_sub_id   TEXT := p_data ->> 'subscription_id';
  v_cust_id  TEXT := p_data -> 'customer' ->> 'customer_id';
  v_email    TEXT := lower(p_data -> 'customer' ->> 'email');
  v_meta_uid TEXT := p_data -> 'metadata' ->> 'user_id';
  v_status   TEXT := p_data ->> 'status';
  v_m        public.memberships%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.webhook_events WHERE id = p_event_id) THEN
    RETURN 'duplicate';
  END IF;

  -- Who is this? Strongest link first: a known subscription, the user id the
  -- checkout route stamped into metadata, a known customer, then the email.
  SELECT user_id INTO v_uid FROM public.memberships
  WHERE v_sub_id IS NOT NULL AND dodo_subscription_id = v_sub_id;

  IF v_uid IS NULL AND v_meta_uid ~* '^[0-9a-f-]{36}$' THEN
    SELECT id INTO v_uid FROM public.profiles WHERE id = v_meta_uid::uuid;
  END IF;
  IF v_uid IS NULL AND v_cust_id IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM public.memberships WHERE dodo_customer_id = v_cust_id;
  END IF;
  IF v_uid IS NULL AND v_email IS NOT NULL THEN
    SELECT p.id INTO v_uid
    FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = v_email;
  END IF;

  IF v_uid IS NULL THEN
    RETURN 'no_user';
  END IF;

  INSERT INTO public.webhook_events (id, type) VALUES (p_event_id, p_type);

  SELECT * INTO v_m FROM public.memberships WHERE user_id = v_uid FOR UPDATE;

  -- ── Lifetime purchase ──
  IF p_type = 'payment.succeeded' THEN
    IF p_plan IS DISTINCT FROM 'lifetime' OR v_sub_id IS NOT NULL THEN
      RETURN 'ignored'; -- subscription charges arrive as subscription.renewed
    END IF;
    INSERT INTO public.memberships AS m
      (user_id, plan, status, access_until, dodo_customer_id, lifetime_payment_id, last_event_at)
    VALUES
      (v_uid, 'lifetime', 'active', 'infinity', v_cust_id, p_data ->> 'payment_id', p_ts)
    ON CONFLICT (user_id) DO UPDATE SET
      plan = 'lifetime', status = 'active', access_until = 'infinity',
      dodo_customer_id = COALESCE(EXCLUDED.dodo_customer_id, m.dodo_customer_id),
      lifetime_payment_id = EXCLUDED.lifetime_payment_id,
      last_event_at = EXCLUDED.last_event_at, updated_at = now();
    RETURN 'applied';
  END IF;

  -- ── Lifetime refund (full only) ──
  IF p_type = 'refund.succeeded' THEN
    IF v_m.plan = 'lifetime'
       AND v_m.lifetime_payment_id = p_data ->> 'payment_id'
       AND COALESCE((p_data ->> 'is_partial')::boolean, false) = false THEN
      UPDATE public.memberships
      SET status = 'refunded', access_until = now(), updated_at = now()
      WHERE user_id = v_uid;
      RETURN 'applied';
    END IF;
    RETURN 'ignored';
  END IF;

  IF p_type NOT LIKE 'subscription.%' OR p_plan IS NULL OR p_plan = 'lifetime' THEN
    RETURN 'ignored';
  END IF;

  -- A lifetime Keeper outlives any leftover subscription's events.
  IF v_m.plan = 'lifetime' AND v_m.access_until = 'infinity' THEN
    RETURN 'ignored';
  END IF;

  -- Dodo doesn't guarantee order; an older event must not undo a newer one.
  IF v_m.last_event_at IS NOT NULL AND p_ts < v_m.last_event_at THEN
    RETURN 'stale';
  END IF;

  -- A member who cancelled and resubscribed has two subscriptions in flight;
  -- the old one's expiry must not end the new one. A different subscription
  -- only takes over the row by becoming active.
  IF v_m.dodo_subscription_id IS NOT NULL
     AND v_sub_id IS DISTINCT FROM v_m.dodo_subscription_id
     AND v_status IS DISTINCT FROM 'active' THEN
    RETURN 'ignored';
  END IF;

  INSERT INTO public.memberships AS m
    (user_id, plan, status, access_until, dodo_customer_id, dodo_subscription_id, last_event_at)
  VALUES (
    v_uid, p_plan, v_status,
    CASE
      WHEN v_status = 'active' THEN (p_data ->> 'next_billing_date')::timestamptz
      ELSE now()
    END,
    v_cust_id, v_sub_id, p_ts
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan = EXCLUDED.plan,
    status = EXCLUDED.status,
    access_until = CASE
      WHEN EXCLUDED.status = 'active' THEN EXCLUDED.access_until
      WHEN EXCLUDED.status IN ('past_due', 'cancelled', 'pending') THEN m.access_until
      ELSE now()
    END,
    dodo_customer_id = COALESCE(EXCLUDED.dodo_customer_id, m.dodo_customer_id),
    dodo_subscription_id = COALESCE(EXCLUDED.dodo_subscription_id, m.dodo_subscription_id),
    last_event_at = EXCLUDED.last_event_at,
    updated_at = now();

  RETURN 'applied';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_dodo_event(TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_dodo_event(TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT)
  TO service_role;

-- ── 5. Tell the member's open tabs ──────────────────────────────────────────
-- Same private per-user topic as bottle events (migration 015); the payload is
-- empty — the client refetches its own row.
CREATE OR REPLACE FUNCTION public.notify_membership_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM realtime.send('{}'::jsonb, 'membership', 'user:' || NEW.user_id::text, true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_membership_changed ON public.memberships;
CREATE TRIGGER on_membership_changed
  AFTER INSERT OR UPDATE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_membership_changed();
