-- Runnable check for migration 041.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/041_keeper_memberships.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000410', 'keeper-sub@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000411', 'keeper-life@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000412', 'keeper-other@example.invalid', now());

DO $$
DECLARE
  sub CONSTANT UUID := '00000000-0000-4000-8000-000000000410';
  life CONSTANT UUID := '00000000-0000-4000-8000-000000000411';
  r TEXT;
  m public.memberships%ROWTYPE;
  spots INT := public.founding_spots_left();
BEGIN
  -- Trial start: active, next billing = trial end. Mapped via metadata.
  r := public.apply_dodo_event('evt_1', 'subscription.active', now() - interval '3 min',
    jsonb_build_object('subscription_id', 'sub_A', 'status', 'active',
      'next_billing_date', now() + interval '7 days',
      'metadata', jsonb_build_object('user_id', sub),
      'customer', jsonb_build_object('customer_id', 'cus_A', 'email', 'x@example.invalid')),
    'monthly');
  IF r <> 'applied' OR NOT public.is_keeper(sub) THEN
    RAISE EXCEPTION 'BUG: trial start → %, keeper %', r, public.is_keeper(sub);
  END IF;

  -- Replay of the same webhook-id is a no-op.
  r := public.apply_dodo_event('evt_1', 'subscription.on_hold', now(), '{}'::jsonb, 'monthly');
  IF r <> 'duplicate' OR NOT public.is_keeper(sub) THEN
    RAISE EXCEPTION 'BUG: replay → %, keeper %', r, public.is_keeper(sub);
  END IF;

  -- Cancel keeps access to the paid end (mapped via subscription id, no metadata).
  r := public.apply_dodo_event('evt_2', 'subscription.cancelled', now() - interval '2 min',
    jsonb_build_object('subscription_id', 'sub_A', 'status', 'cancelled',
      'next_billing_date', now() + interval '7 days'), 'monthly');
  IF r <> 'applied' OR NOT public.is_keeper(sub) THEN
    RAISE EXCEPTION 'BUG: cancelled should run to period end → %, keeper %', r, public.is_keeper(sub);
  END IF;

  -- An older event arriving late can't revive or change anything.
  r := public.apply_dodo_event('evt_old', 'subscription.renewed', now() - interval '1 hour',
    jsonb_build_object('subscription_id', 'sub_A', 'status', 'active',
      'next_billing_date', now() + interval '60 days'), 'monthly');
  SELECT * INTO m FROM public.memberships WHERE user_id = sub;
  IF r <> 'stale' OR m.status <> 'cancelled' THEN
    RAISE EXCEPTION 'BUG: stale event → %, status %', r, m.status;
  END IF;

  -- Expiry ends access.
  r := public.apply_dodo_event('evt_3', 'subscription.expired', now() - interval '1 min',
    jsonb_build_object('subscription_id', 'sub_A', 'status', 'expired',
      'next_billing_date', now() + interval '7 days'), 'monthly');
  IF public.is_keeper(sub) THEN
    RAISE EXCEPTION 'BUG: expired subscription still keeper';
  END IF;

  -- Resubscribed after cancelling: the new subscription takes over, and the
  -- old one's expiry (arriving later) must not end it.
  r := public.apply_dodo_event('evt_3b', 'subscription.active', now() - interval '30 sec',
    jsonb_build_object('subscription_id', 'sub_B', 'status', 'active',
      'next_billing_date', now() + interval '30 days',
      'metadata', jsonb_build_object('user_id', sub)), 'monthly');
  r := public.apply_dodo_event('evt_3c', 'subscription.expired', now() - interval '10 sec',
    jsonb_build_object('subscription_id', 'sub_A', 'status', 'expired',
      'metadata', jsonb_build_object('user_id', sub)), 'monthly');
  IF r <> 'ignored' OR NOT public.is_keeper(sub) THEN
    RAISE EXCEPTION 'BUG: old subscription expiry ended the new one → %, keeper %', r, public.is_keeper(sub);
  END IF;

  -- Lifetime, mapped by email only; consumes a founding spot.
  r := public.apply_dodo_event('evt_4', 'payment.succeeded', now(),
    jsonb_build_object('payment_id', 'pay_L', 'subscription_id', NULL,
      'customer', jsonb_build_object('customer_id', 'cus_L', 'email', 'KEEPER-LIFE@example.invalid')),
    'lifetime');
  IF r <> 'applied' OR NOT public.is_keeper(life) OR public.founding_spots_left() <> spots - 1 THEN
    RAISE EXCEPTION 'BUG: lifetime → %, keeper %, spots % (was %)',
      r, public.is_keeper(life), public.founding_spots_left(), spots;
  END IF;

  -- A partial refund keeps lifetime; a full one ends it.
  r := public.apply_dodo_event('evt_5', 'refund.succeeded', now(),
    jsonb_build_object('payment_id', 'pay_L', 'is_partial', true,
      'customer', jsonb_build_object('customer_id', 'cus_L')), NULL);
  IF r <> 'ignored' OR NOT public.is_keeper(life) THEN
    RAISE EXCEPTION 'BUG: partial refund → %, keeper %', r, public.is_keeper(life);
  END IF;
  r := public.apply_dodo_event('evt_6', 'refund.succeeded', now(),
    jsonb_build_object('payment_id', 'pay_L', 'is_partial', false,
      'customer', jsonb_build_object('customer_id', 'cus_L')), NULL);
  IF r <> 'applied' OR public.is_keeper(life) THEN
    RAISE EXCEPTION 'BUG: full refund → %, keeper %', r, public.is_keeper(life);
  END IF;

  -- Unknown customer: not recorded, so a dashboard replay can apply it later.
  r := public.apply_dodo_event('evt_7', 'subscription.active', now(),
    jsonb_build_object('subscription_id', 'sub_Z', 'status', 'active',
      'next_billing_date', now() + interval '30 days',
      'customer', jsonb_build_object('email', 'nobody@example.invalid')), 'monthly');
  IF r <> 'no_user' OR EXISTS (SELECT 1 FROM public.webhook_events WHERE id = 'evt_7') THEN
    RAISE EXCEPTION 'BUG: unknown customer → %', r;
  END IF;

  RAISE NOTICE 'ok: trial, replay, cancel-to-period-end, stale, expiry, resubscribe, lifetime, refunds, unknown customer';
END;
$$;

-- Clients: read only their own row, never write, never call the internals.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000412","role":"authenticated"}', true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.memberships) THEN
    RAISE EXCEPTION 'BUG: a client can read another user''s membership';
  END IF;
  BEGIN
    INSERT INTO public.memberships (user_id, plan, status, access_until)
    VALUES ('00000000-0000-4000-8000-000000000412', 'lifetime', 'active', 'infinity');
    RAISE EXCEPTION 'BUG: a client granted itself Keeper';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.apply_dodo_event('evt_x', 'payment.succeeded', now(), '{}'::jsonb, 'lifetime');
    RAISE EXCEPTION 'BUG: a client can call apply_dodo_event';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.is_keeper('00000000-0000-4000-8000-000000000410');
    RAISE EXCEPTION 'BUG: a client can probe is_keeper for any uid';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.founding_spots_left();
  RAISE NOTICE 'ok: client isolation';
END;
$$;

ROLLBACK;
