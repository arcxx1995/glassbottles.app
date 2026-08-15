-- Runnable check for migration 036. Fails (raises) if any of the four fixes
-- regresses. Run against a DB with migrations applied, as a superuser/owner:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/036_delivery_hardening.test.sql
-- Everything runs inside one transaction and rolls back — no data persists.

BEGIN;

-- ── 1. INSERT on bottles is revoked from clients ────────────────────────────
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.bottles', 'INSERT')
     OR has_table_privilege('anon', 'public.bottles', 'INSERT') THEN
    RAISE EXCEPTION 'BUG: clients can still INSERT into bottles — forged '
                    'delivery + quota bypass are open again';
  END IF;
  -- send_bottle() runs SECURITY DEFINER as the owner, so the throw path must
  -- still work: the owner keeps its own privilege.
  IF NOT has_table_privilege(
       (SELECT proowner::regrole::text FROM pg_proc
        WHERE proname = 'send_bottle' AND pronamespace = 'public'::regnamespace),
       'public.bottles', 'INSERT') THEN
    RAISE EXCEPTION 'BUG: send_bottle() owner lost INSERT — every throw fails';
  END IF;
  RAISE NOTICE 'ok: bottles INSERT is server-side only';
END;
$$;

-- Fixtures: one dormant profile, one active profile, one adrift bottle.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000160', 'harden-s@example.invalid'),
  ('00000000-0000-4000-8000-000000000161', 'harden-dormant@example.invalid'),
  ('00000000-0000-4000-8000-000000000162', 'harden-active@example.invalid');
INSERT INTO public.profiles (id, timezone, created_at, last_active) VALUES
  ('00000000-0000-4000-8000-000000000160', 'UTC', now() - interval '1 year', now()),
  ('00000000-0000-4000-8000-000000000161', 'UTC', now() - interval '1 year',
   now() - interval '200 days'),
  ('00000000-0000-4000-8000-000000000162', 'UTC', now() - interval '1 year', now());

-- ── 2. Live receivers are preferred over dormant ones ───────────────────────
-- Every other profile in the DB is made ineligible by claiming its quota, so
-- the only candidates are the two fixtures above.
INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
SELECT p.id, (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date, FALSE, TRUE
FROM   public.profiles p
WHERE  p.id NOT IN ('00000000-0000-4000-8000-000000000161',
                    '00000000-0000-4000-8000-000000000162')
ON CONFLICT (user_id, date) DO UPDATE SET has_received = TRUE;

INSERT INTO public.bottles (id, sender_id, message, sent_at, day_key)
VALUES ('00000000-0000-4000-8000-000000000163',
        '00000000-0000-4000-8000-000000000160',
        'liveness preference', now() - interval '2 hours', CURRENT_DATE);

DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.match_bottle('00000000-0000-4000-8000-000000000163');
  IF (v_result ->> 'receiver_id') IS DISTINCT FROM
     '00000000-0000-4000-8000-000000000162' THEN
    RAISE EXCEPTION 'BUG: matcher picked % — dormant accounts are being '
                    'preferred over active ones (result: %)',
                    v_result ->> 'receiver_id', v_result;
  END IF;
  RAISE NOTICE 'ok: matcher drains the active pool first';
END;
$$;

-- ── 3. A bottle younger than 1 hour is not fed to the matcher ───────────────
INSERT INTO public.bottles (id, sender_id, message, sent_at, day_key)
VALUES ('00000000-0000-4000-8000-000000000164',
        '00000000-0000-4000-8000-000000000160',
        'too young', now() - interval '5 minutes', CURRENT_DATE - 1);

DO $$
BEGIN
  PERFORM public.retry_unmatched_bottles();
  IF EXISTS (SELECT 1 FROM public.bottles
             WHERE id = '00000000-0000-4000-8000-000000000164'
               AND received_at IS NOT NULL) THEN
    RAISE EXCEPTION 'BUG: the 1-hour adrift rule was bypassed by the cron';
  END IF;
  RAISE NOTICE 'ok: sub-1-hour bottles stay adrift';
END;
$$;

-- ── 4. Timezone can only change once per 24h ────────────────────────────────
DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  UPDATE public.profiles SET timezone = 'Pacific/Kiritimati'
  WHERE id = '00000000-0000-4000-8000-000000000160';

  BEGIN
    UPDATE public.profiles SET timezone = 'Pacific/Midway'
    WHERE id = '00000000-0000-4000-8000-000000000160';
  EXCEPTION WHEN check_violation THEN
    v_blocked := TRUE;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'BUG: the day boundary can still be flipped twice a day — '
                    'the daily quota is farmable';
  END IF;

  -- An unchanged timezone must never trip the cooldown: the settings page
  -- saves timezone and email_notifications together.
  UPDATE public.profiles SET timezone = 'Pacific/Kiritimati'
  WHERE id = '00000000-0000-4000-8000-000000000160';

  RAISE NOTICE 'ok: timezone cooldown blocks flips, allows idempotent saves';
END;
$$;

ROLLBACK;
