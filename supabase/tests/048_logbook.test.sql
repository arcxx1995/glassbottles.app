-- Runnable check for migration 048.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/048_logbook.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000480', 'log-keeper@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000481', 'log-stranger@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000482', 'log-never@example.invalid', now());
-- An ex-Keeper: membership ended, the Logbook stays theirs.
INSERT INTO public.memberships (user_id, plan, status, access_until)
VALUES ('00000000-0000-4000-8000-000000000480', 'monthly', 'expired', now() - interval '1 day');

INSERT INTO public.bottles (sender_id, receiver_id, message, sent_at, received_at, day_key, screen, is_stale) VALUES
  ('00000000-0000-4000-8000-000000000480', '00000000-0000-4000-8000-000000000481', 'I threw this',
   now() - interval '3 days', now() - interval '2 days', current_date - 3, 'ok', false),
  ('00000000-0000-4000-8000-000000000480', NULL, 'held ashore',
   now() - interval '2 days', NULL, current_date - 2, 'held', true),
  ('00000000-0000-4000-8000-000000000481', '00000000-0000-4000-8000-000000000480', 'this found me',
   now() - interval '5 days', now() - interval '4 days', current_date - 5, 'ok', false);

SET LOCAL role authenticated;

DO $$
DECLARE
  l JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000482","role":"authenticated"}', true);
  BEGIN
    PERFORM public.get_logbook();
    RAISE EXCEPTION 'BUG: a never-Keeper opened the Logbook';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000480","role":"authenticated"}', true);
  l := public.get_logbook();
  IF jsonb_array_length(l -> 'sent') <> 1 OR l -> 'sent' -> 0 ->> 'message' <> 'I threw this'
     OR NOT (l -> 'sent' -> 0 ->> 'found')::boolean THEN
    RAISE EXCEPTION 'BUG: sent wrong (held must be left out): %', l -> 'sent';
  END IF;
  IF l -> 'received' -> 0 ->> 'message' <> 'this found me' THEN
    RAISE EXCEPTION 'BUG: received wrong: %', l -> 'received';
  END IF;
  IF l::text ~ '0000000481' THEN
    RAISE EXCEPTION 'BUG: the Logbook leaks a stranger';
  END IF;
  RAISE NOTICE 'ok: ex-Keeper reads it, never-Keeper can''t, held left out, strangers anonymous';
END;
$$;

ROLLBACK;
