-- Runnable check for migration 044.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/044_push_and_ripple.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000440', 'ripple-sender@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000441', 'ripple-receiver@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000442', 'ripple-other@example.invalid', now());
UPDATE public.profiles SET timezone = 'UTC'
WHERE id::text LIKE '00000000-0000-4000-8000-00000000044%';

INSERT INTO public.bottles (id, sender_id, receiver_id, message, sent_at, received_at, day_key) VALUES
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-000000000440',
   '00000000-0000-4000-8000-000000000441', 'it reached you', now() - interval '3 hours',
   now() - interval '2 hours', (now() AT TIME ZONE 'UTC')::date - 1),
  ('00000000-0000-4000-8000-0000000004b2', '00000000-0000-4000-8000-000000000440',
   '00000000-0000-4000-8000-000000000441', 'reported one', now() - interval '3 hours',
   now() - interval '2 hours', (now() AT TIME ZONE 'UTC')::date - 2);
UPDATE public.bottles SET is_reported = TRUE WHERE id = '00000000-0000-4000-8000-0000000004b2';

SET LOCAL role authenticated;

-- Neither the sender nor a stranger can ripple; the receiver can, once.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000440","role":"authenticated"}', true);
  IF public.ripple_bottle('00000000-0000-4000-8000-0000000004b1') THEN
    RAISE EXCEPTION 'BUG: the sender rippled their own bottle';
  END IF;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000442","role":"authenticated"}', true);
  IF public.ripple_bottle('00000000-0000-4000-8000-0000000004b1') THEN
    RAISE EXCEPTION 'BUG: a stranger rippled someone else''s bottle';
  END IF;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000441","role":"authenticated"}', true);
  IF NOT public.ripple_bottle('00000000-0000-4000-8000-0000000004b1') THEN
    RAISE EXCEPTION 'BUG: the receiver could not ripple';
  END IF;
  IF public.ripple_bottle('00000000-0000-4000-8000-0000000004b1') THEN
    RAISE EXCEPTION 'BUG: rippled twice';
  END IF;
  IF public.ripple_bottle('00000000-0000-4000-8000-0000000004b2') THEN
    RAISE EXCEPTION 'BUG: rippled a reported bottle';
  END IF;
  IF (SELECT rippled_at FROM public.get_received_bottles() LIMIT 1) IS NULL THEN
    RAISE EXCEPTION 'BUG: receiver can''t see their ripple';
  END IF;
  RAISE NOTICE 'ok: receiver-only, once, never on reported';
END;
$$;

-- The sender sees it (no receiver details) until they ack.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000440","role":"authenticated"}', true);
DO $$
DECLARE
  r JSONB := public.get_today_bottle_status() -> 'ripples';
BEGIN
  IF jsonb_array_length(r) <> 1 OR r::text ~ '0000000441' THEN
    RAISE EXCEPTION 'BUG: ripples wrong or leaking: %', r;
  END IF;
  PERFORM public.ack_ripples();
  IF jsonb_array_length(public.get_today_bottle_status() -> 'ripples') <> 0 THEN
    RAISE EXCEPTION 'BUG: acked ripple still shown';
  END IF;
  RAISE NOTICE 'ok: sender sees the ripple, ack clears it';
END;
$$;

-- Push subscriptions: own rows only; junk endpoints refused.
DO $$
BEGIN
  PERFORM public.save_push_subscription('https://push.example/abc', 'p256', 'auth');
  BEGIN
    PERFORM public.save_push_subscription('javascript:alert(1)', 'p256', 'auth');
    RAISE EXCEPTION 'BUG: non-https endpoint saved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000442","role":"authenticated"}', true);
  PERFORM public.delete_push_subscription('https://push.example/abc');
  IF EXISTS (SELECT 1 FROM public.push_subscriptions) THEN
    RAISE EXCEPTION 'BUG: a user can read another user''s push subscription';
  END IF;
  RESET role;
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint = 'https://push.example/abc') THEN
    RAISE EXCEPTION 'BUG: another user deleted my push subscription';
  END IF;
  RAISE NOTICE 'ok: push subscriptions are per-user';
END;
$$;

-- The push trigger never fails a match, even with push unreachable.
DO $$
BEGIN
  UPDATE public.bottles SET received_at = NULL, receiver_id = NULL, rippled_at = NULL
  WHERE id = '00000000-0000-4000-8000-0000000004b1';
  UPDATE public.bottles SET received_at = now(), receiver_id = '00000000-0000-4000-8000-000000000441'
  WHERE id = '00000000-0000-4000-8000-0000000004b1';
  RAISE NOTICE 'ok: a match with a subscribed sender commits';
END;
$$;

ROLLBACK;
