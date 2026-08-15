-- Runnable check for migration 037. Fails (raises) if the notification email
-- ever goes back to expiring. Run against a DB with migrations applied:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/037_email_never_expires.test.sql
-- Everything runs inside one transaction and rolls back — no data persists.

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000170', 'expire-s@example.invalid'),
  ('00000000-0000-4000-8000-000000000171', 'expire-r@example.invalid'),
  ('00000000-0000-4000-8000-000000000172', 'expire-optout@example.invalid');
INSERT INTO public.profiles (id, timezone, email_notifications) VALUES
  ('00000000-0000-4000-8000-000000000170', 'UTC', TRUE),
  ('00000000-0000-4000-8000-000000000171', 'UTC', TRUE),
  ('00000000-0000-4000-8000-000000000172', 'UTC', FALSE);

-- Three matched-but-unemailed bottles: one far outside the old 7-day window,
-- one at the attempt cap, one whose receiver opted out.
INSERT INTO public.bottles
  (id, sender_id, receiver_id, message, sent_at, received_at, day_key, email_retry_count)
VALUES
  ('00000000-0000-4000-8000-000000000173',
   '00000000-0000-4000-8000-000000000170', '00000000-0000-4000-8000-000000000171',
   'stranded by the old 7-day window', now() - interval '40 days',
   now() - interval '39 days', CURRENT_DATE - 40, 0),
  ('00000000-0000-4000-8000-000000000174',
   '00000000-0000-4000-8000-000000000170', '00000000-0000-4000-8000-000000000171',
   'attempt cap spent', now() - interval '41 days',
   now() - interval '40 days', CURRENT_DATE - 41, 8),
  ('00000000-0000-4000-8000-000000000175',
   '00000000-0000-4000-8000-000000000170', '00000000-0000-4000-8000-000000000172',
   'receiver opted out', now() - interval '42 days',
   now() - interval '41 days', CURRENT_DATE - 42, 0);

SELECT public.retry_unmatched_bottles();

DO $$
DECLARE
  v_old    SMALLINT;
  v_capped SMALLINT;
  v_optout SMALLINT;
BEGIN
  SELECT email_retry_count INTO v_old
  FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000000173';
  SELECT email_retry_count INTO v_capped
  FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000000174';
  SELECT email_retry_count INTO v_optout
  FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000000175';

  IF v_old <> 1 THEN
    RAISE EXCEPTION 'BUG: a 39-day-old orphan was not retried (count = %). The '
                    'email expires again and needs a manual backfill.', v_old;
  END IF;
  IF v_capped <> 8 THEN
    RAISE EXCEPTION 'BUG: the 8-attempt cap was breached (count = %)', v_capped;
  END IF;
  IF v_optout <> 0 THEN
    RAISE EXCEPTION 'BUG: emailed a receiver who opted out (count = %)', v_optout;
  END IF;
  RAISE NOTICE 'ok: orphans retry at any age, cap holds, opt-outs respected';
END;
$$;

-- Health check reports the numbers an outage would show up in.
DO $$
DECLARE
  v JSONB;
BEGIN
  v := public.notify_config_status();
  IF NOT (v ? 'last_email_sent_at' AND v ? 'email_retryable' AND v ? 'last_delivery_at') THEN
    RAISE EXCEPTION 'BUG: notify_config_status() lost its health fields: %', v;
  END IF;
  RAISE NOTICE 'ok: pipeline health reports %', v;
END;
$$;

ROLLBACK;
