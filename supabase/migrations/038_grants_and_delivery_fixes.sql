-- Migration 038: close the anon/profile grant holes, harden the matcher and
-- make account deletion one atomic cascade — fixes from the 2026-10-18 E2E pass
--
-- Prod still runs Supabase's legacy default privileges (ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ON FUNCTIONS/TABLES TO anon, authenticated), so
-- every object starts fully exposed and only an explicit REVOKE closes it.
--
-- 1. retry_unmatched_bottles() was executable by anon (SECURITY).
--    009 revoked PUBLIC and authenticated, never anon, and the default grant
--    to anon is explicit. Anyone holding the public anon key could POST
--    /rest/v1/rpc/retry_unmatched_bottles: a full matching pass on demand, and
--    every call burned one of the 8 email retries (033) of every pending
--    notification. Fix: revoke from anon.
--
-- 2. profiles UPDATE was never column-restricted (SECURITY).
--    "profiles: update own" only checks the row. Through PostgREST a user could
--      - PATCH timezone_changed_at = NULL, skipping the 24h cooldown (036) and
--        reopening daily-quota farming across the date line,
--      - PATCH last_active into the future, or created_at/last_active to NULL
--        (NULLs sort first under the matcher's DESC), and jump the receiver
--        queue ahead of everyone.
--    Fix: clients may update timezone, email_notifications and last_active
--    only, and a client-written last_active is clamped to now().
--
-- 3. POSIX timezone strings passed the validator (SECURITY).
--    `now() AT TIME ZONE 'X-167'` is legal Postgres and lands 7 days ahead.
--    The API route checks Intl, but a direct PostgREST write does not. Fix:
--    the zone must be a real IANA name from pg_timezone_names.
--
-- 4. handle_new_user() was SECURITY DEFINER with no fixed search_path.
--
-- 5. daily_quotas flags were nullable. A has_received = NULL row passes the
--    matcher's "not received today" test but can never be claimed
--    (WHERE has_received = FALSE), so match_bottle() looped on it forever,
--    holding the cron's advisory lock: every future delivery stopped. Fix:
--    NOT NULL, plus an iteration cap on the claim loop.
--
-- 6. The matcher delivered to unconfirmed signups. handle_new_user() makes a
--    profile before the email is confirmed, and created_at counted as "active"
--    for 30 days, so mistyped and never-confirmed accounts were *preferred*
--    receivers: dead inboxes, plus notification mail to addresses nobody
--    verified. Fix: only email-confirmed users receive (Google sign-ins are
--    confirmed on creation).
--
-- 7. Re-enabling notifications re-announced already-read bottles. The 037
--    retry pass has no age window and never checked is_read. Fix: skip read
--    bottles, and index the pass's real predicate (030's index still filters
--    on is_stale, which the query no longer uses).
--
-- 8. One cron run held the public_stats row lock for its whole transaction.
--    Every match decremented adrift_count through a row trigger, so the first
--    match locked the single stats row until the run committed, and every
--    concurrent send_bottle() (whose INSERT triggers update the same row)
--    waited for the entire run. Fix: the cron defers its decrements and
--    applies one delta at the very end.
--
-- 9. Account deletion was five non-atomic API calls. A failure between them
--    left inboxes unlinked with the account still alive, and the cron could
--    match a new bottle to the user mid-deletion, failing deleteUser on the
--    FK. Fix: ON DELETE actions + a BEFORE DELETE trigger, so deleting the
--    auth user is a single cascade. The route only calls admin.deleteUser().
--
-- 10. The 21-bottle sailing ceiling was enforced in the client only.
--
-- 11. get_todays_bottle_count() compared day_key — the SENDER's local date
--     since 019 — with the UTC date, dropping bottles thrown "today" from
--     timezones ahead of or behind UTC. Fix: count by sent_at.

-- ── 1. anon cannot run the cron ─────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.retry_unmatched_bottles() FROM anon;

-- ── 2. Profile column grants ────────────────────────────────────────────────
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT  UPDATE (timezone, email_notifications, last_active)
  ON public.profiles TO authenticated;

-- ── 3 + 2. Timezone validator: IANA names only, client liveness clamped ────
CREATE OR REPLACE FUNCTION public.validate_profile_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.timezone IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone)
     AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'invalid timezone: %', NEW.timezone
      USING ERRCODE = '23514'; -- check_violation, same class the API maps
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    IF OLD.timezone_changed_at IS NOT NULL
       AND OLD.timezone_changed_at > now() - interval '24 hours' THEN
      RAISE EXCEPTION 'timezone was already changed in the last 24 hours'
        USING ERRCODE = '23514';
    END IF;
    NEW.timezone_changed_at := now();
  END IF;

  -- A client may say "I'm here", never "I'll be here next year". Not
  -- SECURITY DEFINER, so current_user is the PostgREST role on client writes
  -- and the owner inside send_bottle() and other server paths.
  IF TG_OP = 'UPDATE' AND current_user IN ('authenticated', 'anon')
     AND NEW.last_active IS DISTINCT FROM OLD.last_active THEN
    NEW.last_active := now();
  END IF;

  RETURN NEW;
END;
$$;

-- Existing rows holding a non-IANA zone go back to UTC. The cooldown trigger
-- would reject this as a second change, and it is not the user's change.
ALTER TABLE public.profiles DISABLE TRIGGER validate_timezone;
UPDATE public.profiles
SET    timezone = 'UTC'
WHERE  timezone IS NOT NULL
  AND  timezone NOT IN (SELECT name FROM pg_timezone_names);
UPDATE public.profiles
SET    last_active = now()
WHERE  last_active > now();
ALTER TABLE public.profiles ENABLE TRIGGER validate_timezone;

-- ── 4. handle_new_user: pinned search_path ──────────────────────────────────
ALTER FUNCTION public.handle_new_user() SET search_path = '';

-- ── 5. Quota flags are never NULL ───────────────────────────────────────────
UPDATE public.daily_quotas SET has_sent     = FALSE WHERE has_sent     IS NULL;
UPDATE public.daily_quotas SET has_received = FALSE WHERE has_received IS NULL;
ALTER TABLE public.daily_quotas
  ALTER COLUMN has_sent     SET NOT NULL,
  ALTER COLUMN has_received SET NOT NULL;

-- ── 6 + 5. match_bottle: confirmed receivers only, bounded claim loop ──────
-- Verbatim migration 036 body except the auth.users join, IS TRUE on the
-- liveness sort, and the loop cap.
CREATE OR REPLACE FUNCTION public.match_bottle(p_bottle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bottle        RECORD;
  v_receiver_id   UUID;
  v_receiver_date DATE;
  v_claimed       UUID;
  v_attempts      INTEGER := 0;
BEGIN
  SELECT id, sender_id, received_at, sent_at
  INTO   v_bottle
  FROM   public.bottles
  WHERE  id = p_bottle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not found');
  END IF;

  IF v_bottle.received_at IS NOT NULL THEN
    RETURN jsonb_build_object('matched', true, 'reason', 'already matched');
  END IF;

  IF v_bottle.sent_at > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('matched', false, 'queued', true, 'reason', 'too early');
  END IF;

  -- Candidate → claim loop (029). A lost claim means another bottle took this
  -- receiver between our SELECT and INSERT, so the next SELECT excludes them.
  -- The cap is a backstop: if candidate and claim ever disagree again (038:
  -- NULL has_received did), the bottle waits a tick instead of spinning the
  -- cron forever.
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 20 THEN
      RETURN jsonb_build_object(
        'matched', false, 'queued', true, 'reason', 'claim contention'
      );
    END IF;

    SELECT p.id,
           (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
    INTO   v_receiver_id, v_receiver_date
    FROM   public.profiles p
    JOIN   auth.users u ON u.id = p.id
    WHERE  p.id <> v_bottle.sender_id
      AND  u.email_confirmed_at IS NOT NULL    -- 038: no dead / unverified inboxes
      AND  NOT EXISTS (
             SELECT 1
             FROM   public.daily_quotas dq
             WHERE  dq.user_id      = p.id
               AND  dq.date         = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
               AND  dq.has_received = TRUE
           )
    ORDER BY (COALESCE(p.last_active, p.created_at) > now() - interval '30 days') IS TRUE DESC,
             random()
    LIMIT 1;

    IF v_receiver_id IS NULL THEN
      RETURN jsonb_build_object(
        'matched', false, 'queued', true, 'reason', 'no eligible receiver'
      );
    END IF;

    v_claimed := NULL;
    INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
    VALUES (v_receiver_id, v_receiver_date, FALSE, TRUE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET has_received = TRUE
    WHERE daily_quotas.has_received = FALSE
    RETURNING user_id INTO v_claimed;

    IF v_claimed IS NOT NULL THEN
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.bottles
  SET    receiver_id = v_receiver_id,
         received_at = now()
  WHERE  id = p_bottle_id;

  RETURN jsonb_build_object(
    'matched', true,
    'receiver_id', v_receiver_id,
    'bottle_id', p_bottle_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.match_bottle(UUID) TO service_role;

COMMENT ON FUNCTION public.match_bottle(UUID) IS
  'Claim-first, race-free matcher (029). Refuses bottles younger than 1 hour '
  '(022). Email-confirmed receivers only, active ones first, bounded claim '
  'loop (038). Service role only.';

-- ── 8. adrift_count: the cron defers its decrements ─────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_adrift_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old int := 0;
  v_new int := 0;
BEGIN
  -- retry_unmatched_bottles() applies one total for its matches at the end of
  -- its run (038) so the stats row is not locked for the whole run.
  IF TG_OP = 'UPDATE'
     AND current_setting('glassbottles.defer_adrift', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.received_at IS NULL AND OLD.is_stale = FALSE THEN
    v_old := 1;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.received_at IS NULL AND NEW.is_stale = FALSE THEN
    v_new := 1;
  END IF;
  IF v_new <> v_old THEN
    UPDATE public.public_stats
    SET adrift_count = adrift_count + (v_new - v_old)
    WHERE id;
  END IF;
  RETURN NULL; -- AFTER trigger
END;
$$;

-- ── 7 + 8. retry_unmatched_bottles ──────────────────────────────────────────
-- Verbatim migration 037 body except: deferred adrift decrements, and pass 2
-- skips bottles the receiver has already read.
CREATE OR REPLACE FUNCTION public.retry_unmatched_bottles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id               UUID;
  v_result           JSONB;
  v_matched_count    INTEGER := 0;
  v_supabase_url     TEXT;
  v_service_role_key TEXT;
  v_notify_url       TEXT;
  v_pending          INTEGER;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('retry_unmatched_bottles')) THEN
    RAISE WARNING 'retry_unmatched_bottles: previous run still in progress — skipping tick';
    RETURN 0;
  END IF;

  SELECT c.supabase_url, c.service_role_key
  INTO   v_supabase_url, v_service_role_key
  FROM   public._notify_config() c;

  IF v_supabase_url IS NULL OR v_service_role_key IS NULL THEN
    RAISE WARNING 'retry_unmatched_bottles: notify config missing — emails are '
                  'NOT being sent. Run set_notify_config().';
  END IF;

  v_notify_url := CASE
    WHEN v_supabase_url IS NOT NULL
    THEN v_supabase_url || '/functions/v1/notify-receiver'
    ELSE NULL
  END;

  -- ── Pass 1: match adrift bottles, email each fresh match ──────────────────
  PERFORM set_config('glassbottles.defer_adrift', 'on', true);

  FOR v_id IN
    SELECT id
    FROM   public.bottles
    WHERE  received_at IS NULL
      AND  is_stale    = FALSE
      AND  sent_at    <= now() - interval '1 hour'
    ORDER BY random()
  LOOP
    BEGIN
      v_result := public.match_bottle(v_id);

      IF COALESCE((v_result ->> 'matched')::boolean, false)
         AND (v_result ? 'receiver_id') THEN
        v_matched_count := v_matched_count + 1;

        IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
          PERFORM net.http_post(
            url     := v_notify_url,
            headers := jsonb_build_object(
                         'Content-Type',  'application/json',
                         'Authorization', 'Bearer ' || v_service_role_key
                       ),
            body    := jsonb_build_object('bottle_id', v_id)
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'retry_unmatched_bottles: match_bottle(%) failed: %', v_id, SQLERRM;
    END;
  END LOOP;

  PERFORM set_config('glassbottles.defer_adrift', 'off', true);

  -- ── Pass 2: any matched, unread bottle whose email never landed ───────────
  IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
    FOR v_id IN
      SELECT b.id
      FROM   public.bottles b
      JOIN   public.profiles p ON p.id = b.receiver_id
      WHERE  b.received_at IS NOT NULL
        AND  b.email_notified_at IS NULL
        AND  b.is_read IS NOT TRUE        -- 038: they've seen it; don't announce it
        AND  b.email_retry_count < 8
        AND  p.email_notifications = TRUE
        AND  b.received_at < now() - interval '10 minutes'
      ORDER BY b.email_retry_count ASC, b.received_at ASC
      LIMIT  20
    LOOP
      UPDATE public.bottles
      SET    email_retry_count = email_retry_count + 1
      WHERE  id = v_id;

      PERFORM net.http_post(
        url     := v_notify_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || v_service_role_key
                   ),
        body    := jsonb_build_object('bottle_id', v_id)
      );
    END LOOP;

    SELECT count(*) INTO v_pending
    FROM   public.bottles b
    JOIN   public.profiles p ON p.id = b.receiver_id
    WHERE  b.received_at IS NOT NULL
      AND  b.email_notified_at IS NULL
      AND  b.is_read IS NOT TRUE
      AND  b.email_retry_count < 8
      AND  p.email_notifications = TRUE
      AND  b.received_at < now() - interval '10 minutes';
    IF v_pending > 0 THEN
      RAISE WARNING 'retry_unmatched_bottles: % notification email(s) still pending after this tick', v_pending;
    END IF;
  END IF;

  -- One stats-row write per run, as late as possible: the lock it takes is
  -- held only until this transaction commits, a moment from now.
  IF v_matched_count > 0 THEN
    UPDATE public.public_stats
    SET    adrift_count = adrift_count - v_matched_count
    WHERE  id;
  END IF;

  RETURN v_matched_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.retry_unmatched_bottles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retry_unmatched_bottles() FROM anon;
REVOKE EXECUTE ON FUNCTION public.retry_unmatched_bottles() FROM authenticated;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Every-15-min retry, single-flight via advisory lock (036): (1) match adrift '
  'bottles older than 1 hour, firing notify-receiver per fresh match; (2) '
  're-fire notify-receiver for matched, UNREAD bottles still missing '
  'email_notified_at — no age window (037), 20 per tick, 8 attempts per bottle '
  '(033). adrift_count is decremented once per run (038). Not callable by '
  'clients (038).';

DROP INDEX IF EXISTS public.idx_bottles_email_retry;
CREATE INDEX IF NOT EXISTS idx_bottles_email_pending
  ON public.bottles (email_retry_count, received_at)
  WHERE received_at IS NOT NULL
    AND email_notified_at IS NULL;

-- ── 9. Deleting the auth user is one atomic cascade ─────────────────────────
-- auth.users → profiles already CASCADEs (001). These make the rows that
-- reference profiles follow along instead of blocking the delete.
ALTER TABLE public.bottles
  DROP CONSTRAINT bottles_sender_id_fkey,
  ADD  CONSTRAINT bottles_sender_id_fkey
       FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  DROP CONSTRAINT bottles_receiver_id_fkey,
  ADD  CONSTRAINT bottles_receiver_id_fkey
       FOREIGN KEY (receiver_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.daily_quotas
  DROP CONSTRAINT daily_quotas_user_id_fkey,
  ADD  CONSTRAINT daily_quotas_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Bottles nobody has seen go with their sender: with sender_id NULL the
-- matcher's "not the sender" test is NULL-poisoned and they would drift
-- forever. Delivered ones stay in the receiver's inbox (SET NULL above).
-- SECURITY DEFINER: GoTrue deletes auth.users as supabase_auth_admin, which
-- has no privileges on public.bottles.
CREATE OR REPLACE FUNCTION public.delete_adrift_bottles_of_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.bottles
  WHERE  sender_id = OLD.id
    AND  received_at IS NULL;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_adrift_bottles_of_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS delete_adrift_bottles ON public.profiles;
CREATE TRIGGER delete_adrift_bottles
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_adrift_bottles_of_profile();

-- ── 10. send_bottle: server-side sailing ceiling ────────────────────────────
-- Verbatim migration 024 body plus the ceiling check.
CREATE OR REPLACE FUNCTION public.send_bottle(p_message TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid      UUID := auth.uid();
  today    DATE := public.user_local_date(auth.uid());
  trimmed  TEXT := btrim(COALESCE(p_message, ''));
  v_bottle JSONB;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF trimmed = '' THEN
    RAISE EXCEPTION 'Message is required' USING ERRCODE = '23514';
  END IF;
  IF char_length(trimmed) > 1000 THEN
    RAISE EXCEPTION 'Message too long — max 1000 characters' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_quotas
    WHERE user_id = uid AND date = today AND has_sent = TRUE
  ) THEN
    RAISE EXCEPTION 'Already sent a bottle today' USING ERRCODE = '23505';
  END IF;

  -- 038: the home screen stops at 21 drifting bottles; so does the server.
  IF (SELECT count(*) FROM public.bottles
      WHERE sender_id = uid AND received_at IS NULL) >= 21 THEN
    RAISE EXCEPTION '21 bottles are still drifting' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.bottles (sender_id, message)
  VALUES (uid, trimmed)
  RETURNING jsonb_build_object(
    'id',          id,
    'message',     message,
    'sent_at',     sent_at,
    'received_at', received_at,
    'read_at',     read_at,
    'day_key',     day_key,
    'is_read',     is_read,
    'is_reported', is_reported,
    'is_stale',    is_stale
  ) INTO v_bottle;

  INSERT INTO public.daily_quotas (user_id, date, has_sent)
  VALUES (uid, today, TRUE)
  ON CONFLICT (user_id, date) DO UPDATE SET has_sent = TRUE;

  UPDATE public.profiles SET last_active = now() WHERE id = uid;

  RETURN v_bottle;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_bottle(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_bottle(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.send_bottle(TEXT) TO authenticated;

-- ── 11. Ocean count by throw time, not the sender's local date ─────────────
CREATE OR REPLACE FUNCTION public.get_todays_bottle_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::integer
  FROM public.bottles
  WHERE sent_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'
    AND is_stale = FALSE
    AND auth.uid() IS NOT NULL;
$$;

-- ── 12. Read and report move off Vercel; reported bottles leave the inbox ───
-- Opening a bottle now marks it read (auto-read), which makes this the hottest
-- write after send_bottle(). Same move as 024: one Supabase round trip, zero
-- Vercel compute, identity from auth.uid(). Both return whether a row of the
-- caller's changed state, so the client can tell "not yours" from success.
CREATE OR REPLACE FUNCTION public.mark_bottle_read(p_bottle_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.bottles
  SET    is_read = TRUE,
         read_at = COALESCE(read_at, now())
  WHERE  id = p_bottle_id
    AND  receiver_id = uid;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Liveness (036): someone who reads but rarely throws must stay matchable.
  UPDATE public.profiles SET last_active = now() WHERE id = uid;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_bottle(p_bottle_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.bottles
  SET    is_reported = TRUE,
         is_read     = TRUE,                 -- leaving the inbox clears the badge too
         read_at     = COALESCE(read_at, now())
  WHERE  id = p_bottle_id
    AND  receiver_id = uid;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_bottle_read(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.report_bottle(UUID)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_bottle_read(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.report_bottle(UUID)    TO authenticated;

-- Verbatim migration 035 body plus the is_reported filter: the FAQ promises a
-- reported bottle is "pulled from the water".
CREATE OR REPLACE FUNCTION public.get_received_bottles()
RETURNS TABLE (
  id UUID,
  message TEXT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  day_key DATE,
  is_read BOOLEAN,
  is_reported BOOLEAN,
  is_stale BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.message, b.sent_at, b.received_at, b.read_at,
         b.day_key, b.is_read, b.is_reported, b.is_stale
  FROM public.bottles b
  WHERE b.receiver_id = auth.uid()
    AND b.is_reported IS NOT TRUE
  ORDER BY b.received_at DESC;
$$;
