-- Runnable check for migration 057.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/057_shelf_keeper_only.test.sql
-- Runs inside one transaction and rolls back.

BEGIN;

ALTER TABLE public.profiles ALTER COLUMN age_confirmed_at SET DEFAULT now();
ALTER TABLE public.bottles  ALTER COLUMN screen SET DEFAULT 'ok';

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000570', 'shelf-sender@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000571', 'shelf-free@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000572', 'shelf-keeper@example.invalid', now());
UPDATE public.profiles SET timezone = 'UTC'
WHERE id::text LIKE '00000000-0000-4000-8000-00000000057%';
INSERT INTO public.memberships (user_id, plan, status, access_until) VALUES
  ('00000000-0000-4000-8000-000000000572', 'yearly', 'active', now() + interval '30 days');

-- One dressed and one undressed bottle each, delivered to both receivers.
INSERT INTO public.bottles (id, sender_id, receiver_id, message, sent_at, received_at, day_key, style) VALUES
  ('00000000-0000-4000-8000-0000000057b1', '00000000-0000-4000-8000-000000000570',
   '00000000-0000-4000-8000-000000000571', 'dressed', now() - interval '3 days', now(),
   (now() AT TIME ZONE 'UTC')::date - 3, '{"glass":"amber","paper":"dusk"}'),
  ('00000000-0000-4000-8000-0000000057b2', '00000000-0000-4000-8000-000000000570',
   '00000000-0000-4000-8000-000000000571', 'bare', now() - interval '4 days', now() - interval '1 day',
   (now() AT TIME ZONE 'UTC')::date - 4, NULL),
  ('00000000-0000-4000-8000-0000000057b3', '00000000-0000-4000-8000-000000000570',
   '00000000-0000-4000-8000-000000000572', 'dressed', now() - interval '5 days', now(),
   (now() AT TIME ZONE 'UTC')::date - 5, '{"glass":"amber","paper":"dusk"}'),
  ('00000000-0000-4000-8000-0000000057b4', '00000000-0000-4000-8000-000000000570',
   '00000000-0000-4000-8000-000000000572', 'empty', now() - interval '6 days', now() - interval '1 day',
   (now() AT TIME ZONE 'UTC')::date - 6, '{}');

-- Every non-default piece is Keeper; only the sort 0 defaults stay free.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.atelier_pieces WHERE tier = 'free' AND sort > 0)
     OR (SELECT count(*) FROM public.atelier_pieces WHERE tier = 'free') <> 4 THEN
    RAISE EXCEPTION 'BUG: free pieces beyond the defaults remain';
  END IF;
  RAISE NOTICE 'ok: catalogue tiers';
END;
$$;

SET LOCAL role authenticated;

-- Free receiver: dressing withheld on every read path, `dressed` still true.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000571","role":"authenticated"}', true);
DO $$
DECLARE
  r RECORD;
  s JSONB := public.get_today_bottle_status() -> 'receivedBottle';
BEGIN
  SELECT * INTO r FROM public.get_received_bottles() WHERE message = 'dressed';
  IF r.style IS NOT NULL OR NOT r.dressed THEN
    RAISE EXCEPTION 'BUG: free receiver got style % dressed %', r.style, r.dressed;
  END IF;
  SELECT * INTO r FROM public.get_received_bottles() WHERE message = 'bare';
  IF r.style IS NOT NULL OR r.dressed THEN
    RAISE EXCEPTION 'BUG: bare bottle reads style % dressed %', r.style, r.dressed;
  END IF;
  IF s ->> 'style' IS NOT NULL OR NOT (s ->> 'dressed')::boolean THEN
    RAISE EXCEPTION 'BUG: status RPC gave a free receiver %', s;
  END IF;
  RAISE NOTICE 'ok: free receiver gets dressed, not style';
END;
$$;

-- Free user can't dress, but plain throws still work.
DO $$
BEGIN
  BEGIN
    PERFORM public.send_bottle('hi', '{"ink":"sepia"}');
    RAISE EXCEPTION 'BUG: a free user threw a formerly free piece';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: free user refused pieces';
END;
$$;

-- Keeper: sees what was sent; an empty style counts as undressed.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000572","role":"authenticated"}', true);
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.get_received_bottles() WHERE message = 'dressed';
  IF r.style ->> 'glass' <> 'amber' OR NOT r.dressed THEN
    RAISE EXCEPTION 'BUG: Keeper got style % dressed %', r.style, r.dressed;
  END IF;
  SELECT * INTO r FROM public.get_received_bottles() WHERE message = 'empty';
  IF r.style IS NOT NULL OR r.dressed THEN
    RAISE EXCEPTION 'BUG: empty style reads % dressed %', r.style, r.dressed;
  END IF;
  RAISE NOTICE 'ok: Keeper sees the sender''s look';
END;
$$;

-- Lapse: the Keeper's whole shelf turns plain, and the stored look survives.
RESET role;
UPDATE public.memberships SET access_until = now() - interval '1 second'
WHERE user_id = '00000000-0000-4000-8000-000000000572';
SET LOCAL role authenticated;
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.get_received_bottles() WHERE message = 'dressed';
  IF r.style IS NOT NULL OR NOT r.dressed THEN
    RAISE EXCEPTION 'BUG: lapsed member got style % dressed %', r.style, r.dressed;
  END IF;
  RAISE NOTICE 'ok: lapse turns the shelf plain';
END;
$$;

-- Rejoining brings it back.
RESET role;
UPDATE public.memberships SET access_until = now() + interval '30 days'
WHERE user_id = '00000000-0000-4000-8000-000000000572';
SET LOCAL role authenticated;
DO $$
BEGIN
  IF (SELECT style ->> 'glass' FROM public.get_received_bottles() WHERE message = 'dressed') <> 'amber' THEN
    RAISE EXCEPTION 'BUG: rejoining did not restore the dressing';
  END IF;
  RAISE NOTICE 'ok: rejoining restores the dressing';
END;
$$;

ROLLBACK;
