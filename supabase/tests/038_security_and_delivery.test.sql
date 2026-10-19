-- Runnable check for migration 038. Fails (raises) if any fix regresses.
-- Run against a DB with migrations applied, as a superuser/owner:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/038_security_and_delivery.test.sql
-- Everything runs inside one transaction and rolls back — no data persists.

BEGIN;

-- ── 1. Nothing privileged is callable with the public anon key ─────────────
DO $$
DECLARE v TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v
  FROM   pg_proc p
  WHERE  p.pronamespace = 'public'::regnamespace
    AND  p.prosecdef
    AND  p.prorettype <> 'trigger'::regtype
    AND  p.proname <> 'get_public_stats'          -- landing page, by design
    AND  has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: anon can EXECUTE SECURITY DEFINER function(s): %', v;
  END IF;
  RAISE NOTICE 'ok: anon reaches no privileged function';
END;
$$;

-- ── 2. Clients write only the profile columns they own ─────────────────────
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.profiles', 'timezone_changed_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE')
     OR has_table_privilege('anon', 'public.profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'BUG: clients can rewrite cooldown/age columns — '
                    'timezone cooldown and matcher priority are forgeable';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.profiles', 'timezone', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'email_notifications', 'UPDATE') THEN
    RAISE EXCEPTION 'BUG: settings page can no longer save timezone/email prefs';
  END IF;
  RAISE NOTICE 'ok: profile column grants';
END;
$$;

-- Fixtures. S = sender, R = confirmed receiver, U = unconfirmed signup,
-- D = account about to be deleted.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000000380', 'g38-s@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000381', 'g38-r@example.invalid', now()),
  ('00000000-0000-4000-8000-000000000382', 'g38-u@example.invalid', NULL),
  ('00000000-0000-4000-8000-000000000383', 'g38-d@example.invalid', now());

-- ── 3. A client cannot fake liveness or dodge the timezone guard ───────────
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000381","role":"authenticated"}', true);

UPDATE public.profiles SET last_active = now() + interval '1 year'
WHERE id = '00000000-0000-4000-8000-000000000381';

DO $$
BEGIN
  BEGIN
    UPDATE public.profiles SET timezone = 'X-167'   -- POSIX: +7 days
    WHERE id = '00000000-0000-4000-8000-000000000381';
    RAISE EXCEPTION 'BUG: POSIX timezone X-167 accepted — shifts the local day by a week';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
RESET role;

DO $$
BEGIN
  IF (SELECT last_active FROM public.profiles
      WHERE id = '00000000-0000-4000-8000-000000000381') > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'BUG: client stored a future last_active — jumps the receiver queue';
  END IF;
  RAISE NOTICE 'ok: client liveness clamped, POSIX zones rejected';
END;
$$;

-- ── 4. Quota flags can never be NULL (matcher claim loop would spin) ───────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
    VALUES ('00000000-0000-4000-8000-000000000381', CURRENT_DATE - 400, FALSE, NULL);
    RAISE EXCEPTION 'BUG: has_received accepts NULL — matcher loops forever on it';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: quota flags NOT NULL';
END;
$$;

-- ── 5. Unconfirmed signups never receive ───────────────────────────────────
-- Every other profile is made ineligible, leaving U as the only candidate.
INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
SELECT p.id, (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date, FALSE, TRUE
FROM   public.profiles p
WHERE  p.id <> '00000000-0000-4000-8000-000000000382'
ON CONFLICT (user_id, date) DO UPDATE SET has_received = TRUE;

INSERT INTO public.bottles (id, sender_id, message, sent_at, day_key) VALUES
  ('00000000-0000-4000-8000-000000003801',
   '00000000-0000-4000-8000-000000000380', 'to nobody yet',
   now() - interval '2 hours', CURRENT_DATE - 1);

DO $$
DECLARE v JSONB := public.match_bottle('00000000-0000-4000-8000-000000003801');
BEGIN
  IF (v ->> 'matched')::boolean THEN
    RAISE EXCEPTION 'BUG: bottle matched to an unconfirmed signup: %', v;
  END IF;
  RAISE NOTICE 'ok: unconfirmed signup skipped (%)', v ->> 'reason';
END;
$$;

-- ── 6. Read bottles don't trigger a "washed up" email burst ────────────────
INSERT INTO public.bottles
  (id, sender_id, receiver_id, message, sent_at, received_at, day_key, is_read, read_at)
VALUES
  ('00000000-0000-4000-8000-000000003802',
   '00000000-0000-4000-8000-000000000380', '00000000-0000-4000-8000-000000000381',
   'already read while opted out', now() - interval '30 days',
   now() - interval '29 days', CURRENT_DATE - 30, TRUE, now() - interval '28 days');

SELECT public.retry_unmatched_bottles();

DO $$
BEGIN
  IF (SELECT email_retry_count FROM public.bottles
      WHERE id = '00000000-0000-4000-8000-000000003802') <> 0 THEN
    RAISE EXCEPTION 'BUG: emailed "a bottle washed up" for a bottle already read';
  END IF;
  RAISE NOTICE 'ok: read bottles are not re-announced';
END;
$$;

-- ── 6b. Deferred adrift decrements still land exactly ──────────────────────
-- R is made eligible again so the cron has a real match to make.
DELETE FROM public.daily_quotas
WHERE user_id = '00000000-0000-4000-8000-000000000381';
-- Other adrift bottles in the DB would compete for R; hold them under the
-- 1-hour rule for this tick (rolled back with everything else).
UPDATE public.bottles SET sent_at = now()
WHERE received_at IS NULL AND id <> '00000000-0000-4000-8000-000000003801';

CREATE TEMP TABLE drift_before ON COMMIT DROP AS
SELECT (SELECT adrift_count FROM public.public_stats)
     - (SELECT count(*) FROM public.bottles
        WHERE received_at IS NULL AND is_stale = FALSE) AS skew;

SELECT public.retry_unmatched_bottles();

DO $$
BEGIN
  IF (SELECT received_at FROM public.bottles
      WHERE id = '00000000-0000-4000-8000-000000003801') IS NULL THEN
    RAISE EXCEPTION 'BUG: cron did not deliver to an eligible confirmed receiver';
  END IF;
  IF (SELECT adrift_count FROM public.public_stats)
     - (SELECT count(*) FROM public.bottles WHERE received_at IS NULL AND is_stale = FALSE)
     <> (SELECT skew FROM drift_before) THEN
    RAISE EXCEPTION 'BUG: adrift_count drifted from the real count after a cron run';
  END IF;
  RAISE NOTICE 'ok: cron delivers, adrift_count stays exact';
END;
$$;

-- ── 7. Deleting the auth user is one atomic cascade ────────────────────────
INSERT INTO public.bottles (id, sender_id, receiver_id, message, sent_at, received_at, day_key) VALUES
  ('00000000-0000-4000-8000-000000003803',      -- D's, still adrift
   '00000000-0000-4000-8000-000000000383', NULL, 'adrift from D',
   now() - interval '3 hours', NULL, CURRENT_DATE - 2),
  ('00000000-0000-4000-8000-000000003804',      -- D's, delivered to R
   '00000000-0000-4000-8000-000000000383', '00000000-0000-4000-8000-000000000381',
   'delivered from D', now() - interval '5 days', now() - interval '4 days', CURRENT_DATE - 5),
  ('00000000-0000-4000-8000-000000003805',      -- S's, delivered to D
   '00000000-0000-4000-8000-000000000380', '00000000-0000-4000-8000-000000000383',
   'delivered to D', now() - interval '6 days', now() - interval '5 days', CURRENT_DATE - 6);

DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000383';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000003803') THEN
    RAISE EXCEPTION 'BUG: deleted account left a bottle drifting';
  END IF;
  IF (SELECT sender_id FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000003804') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000003804') THEN
    RAISE EXCEPTION 'BUG: receiver lost, or still links to, a deleted sender''s bottle';
  END IF;
  IF (SELECT receiver_id FROM public.bottles WHERE id = '00000000-0000-4000-8000-000000003805') IS NOT NULL THEN
    RAISE EXCEPTION 'BUG: bottle still links to a deleted receiver';
  END IF;
  IF EXISTS (SELECT 1 FROM public.daily_quotas WHERE user_id = '00000000-0000-4000-8000-000000000383') THEN
    RAISE EXCEPTION 'BUG: deleted account left quota rows';
  END IF;
  RAISE NOTICE 'ok: account deletion cascades atomically';
END;
$$;

-- ── 8. The sailing ceiling holds server-side ───────────────────────────────
INSERT INTO public.bottles (sender_id, message, sent_at, day_key)
SELECT '00000000-0000-4000-8000-000000000381', 'old drifter', now() - make_interval(days => g + 40),
       CURRENT_DATE - (g + 40)
FROM generate_series(1, 21) g;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000381","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.send_bottle('number 22');
    RAISE EXCEPTION 'BUG: send_bottle accepted a 22nd drifting bottle';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: 21-bottle ceiling enforced server-side';
END;
$$;
RESET role;

-- ── 9. Read/report RPCs act only on the caller's own received bottles ──────
-- 3802 was delivered S → R. S (the sender) must not be able to touch it.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000380","role":"authenticated"}', true);
DO $$
BEGIN
  IF public.mark_bottle_read('00000000-0000-4000-8000-000000003805')
     OR public.report_bottle('00000000-0000-4000-8000-000000003802') THEN
    RAISE EXCEPTION 'BUG: a sender (or nobody) could mark/report a bottle';
  END IF;
END;
$$;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000381","role":"authenticated"}', true);
DO $$
BEGIN
  IF NOT public.report_bottle('00000000-0000-4000-8000-000000003802') THEN
    RAISE EXCEPTION 'BUG: receiver could not report their own bottle';
  END IF;
  IF EXISTS (SELECT 1 FROM public.get_received_bottles()
             WHERE id = '00000000-0000-4000-8000-000000003802') THEN
    RAISE EXCEPTION 'BUG: reported bottle still in the inbox';
  END IF;
  IF NOT public.mark_bottle_read('00000000-0000-4000-8000-000000003804') THEN
    RAISE EXCEPTION 'BUG: receiver could not mark their own bottle read';
  END IF;
  RAISE NOTICE 'ok: read/report scoped to receiver, reported bottles leave inbox';
END;
$$;
RESET role;

ROLLBACK;
