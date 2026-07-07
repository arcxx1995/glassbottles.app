-- Runnable check for migration 033. Fails (raises) if the retry cap regresses.
-- Run against a DB with migrations applied, as a superuser/owner role:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/033_email_retry_cap.test.sql
-- Everything runs inside one transaction and rolls back — no data persists.

BEGIN;

-- Fixtures: sender + receiver, two matched-but-never-emailed bottles: one
-- fresh (retryable) and one already at the cap.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000133', 'retry-cap-s@example.invalid'),
  ('00000000-0000-4000-8000-000000000134', 'retry-cap-r@example.invalid');
INSERT INTO public.profiles (id, timezone, email_notifications) VALUES
  ('00000000-0000-4000-8000-000000000133', 'UTC', TRUE),
  ('00000000-0000-4000-8000-000000000134', 'UTC', TRUE);

INSERT INTO public.bottles
  (id, sender_id, receiver_id, message, sent_at, received_at, day_key, email_retry_count)
VALUES
  ('00000000-0000-4000-8000-000000000135',
   '00000000-0000-4000-8000-000000000133',
   '00000000-0000-4000-8000-000000000134',
   'retryable orphan', now() - interval '3 hours', now() - interval '2 hours',
   CURRENT_DATE, 0),
  ('00000000-0000-4000-8000-000000000136',
   '00000000-0000-4000-8000-000000000133',
   '00000000-0000-4000-8000-000000000134',
   'capped orphan', now() - interval '3 hours', now() - interval '2 hours',
   CURRENT_DATE - 1, 8); -- day_key differs: UNIQUE (sender_id, day_key)

SELECT public.retry_unmatched_bottles();

DO $$
DECLARE
  fresh_count  SMALLINT;
  capped_count SMALLINT;
BEGIN
  SELECT email_retry_count INTO fresh_count
  FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000000135';
  SELECT email_retry_count INTO capped_count
  FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000000136';

  IF fresh_count <> 1 THEN
    RAISE EXCEPTION 'BUG: retryable orphan not re-fired (count = %, expected 1)', fresh_count;
  END IF;
  IF capped_count <> 8 THEN
    RAISE EXCEPTION 'BUG: capped orphan was re-fired past the cap (count = %)', capped_count;
  END IF;
  RAISE NOTICE 'ok: retry cap honoured (fresh 0→1, capped stays 8)';
END;
$$;

ROLLBACK;
