-- Migration 026: matcher receiver-race fix + home status + orphaned-email retry
--
-- Three bugs, one migration:
--
-- 1. match_bottle(): receiver double-match race. The function locked only the
--    BOTTLE row, so two concurrent matches for DIFFERENT bottles could both
--    pass the NOT EXISTS eligibility check for the same receiver before either
--    committed, and both write has_received = TRUE — the receiver got two
--    bottles on one local day. Fix: the daily_quotas claim becomes the
--    serialization point. The quota upsert runs BEFORE the bottle update, with
--    a `WHERE has_received = FALSE` guard + RETURNING: the second transaction
--    blocks on the quota row lock, sees TRUE after the first commits, claims
--    nothing, and retries with a fresh candidate.
--    Also inlines the receiver's local date from profiles.timezone instead of
--    calling user_local_date(p.id) (a per-row profiles subquery) inside the
--    correlated NOT EXISTS — one scan, no nested lookups on the hot path.
--
-- 2. get_today_bottle_status(): receivedBottle was filtered by
--    `day_key = today`, but day_key is the SENDER's local throw date. With the
--    1-hour adrift rule + multi-day drift, a bottle received today almost
--    always has an older day_key — quota said has_received = TRUE while
--    receivedBottle came back NULL. Fix: filter by received_at falling on the
--    RECEIVER's local day.
--
-- 3. retry_unmatched_bottles(): notify-receiver releases its email claim
--    (email_notified_at = NULL) on a Resend failure "so the retry cron can
--    re-attempt" — but the cron only iterated UNMATCHED bottles, so a released
--    claim was never retried and the email was permanently lost. Fix: a second
--    pass re-fires notify-receiver for matched, non-stale bottles still
--    lacking email_notified_at. Guards: receiver has notifications on (the
--    edge function re-checks; this just avoids wasted invocations), matched
--    more than 10 minutes ago (gives the first attempt time to stamp its
--    claim; avoids double-firing bottles matched earlier in this same run),
--    and within 7 days (bounds the retry window). notify-receiver's
--    claim-before-send makes any residual double-fire harmless.

-- ── 1. match_bottle: claim-first, race-free matching ─────────────────────────
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
BEGIN
  -- Lock the bottle row for the duration of the transaction. Concurrent
  -- match attempts FOR THIS BOTTLE serialize here.
  SELECT id, sender_id, received_at, sent_at
  INTO   v_bottle
  FROM   public.bottles
  WHERE  id = p_bottle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not found');
  END IF;

  -- Idempotent: already matched. Never touches quota.
  IF v_bottle.received_at IS NOT NULL THEN
    RETURN jsonb_build_object('matched', true, 'reason', 'already matched');
  END IF;

  -- THE 1-HOUR ADRIFT RULE (migration 022): unchanged.
  IF v_bottle.sent_at > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('matched', false, 'queued', true, 'reason', 'too early');
  END IF;

  -- Candidate → claim loop. Each iteration picks a random eligible receiver,
  -- then tries to CLAIM their local-day quota row. Losing the claim (a
  -- concurrent match for another bottle took this receiver first) retries with
  -- a fresh candidate; the committed quota row now fails the NOT EXISTS, so
  -- the loop converges. Timezone is read inline from the joined profile row —
  -- no per-candidate user_local_date() subquery.
  LOOP
    SELECT p.id,
           (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
    INTO   v_receiver_id, v_receiver_date
    FROM   public.profiles p
    WHERE  p.id <> v_bottle.sender_id
      AND  NOT EXISTS (
             SELECT 1
             FROM   public.daily_quotas dq
             WHERE  dq.user_id      = p.id
               AND  dq.date         = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
               AND  dq.has_received = TRUE
           )
    ORDER BY random()
    LIMIT 1;

    IF v_receiver_id IS NULL THEN
      RETURN jsonb_build_object(
        'matched', false, 'queued', true, 'reason', 'no eligible receiver'
      );
    END IF;

    -- THE SERIALIZATION POINT. Insert-or-update the receiver's quota row for
    -- their local day, but only take it if has_received is still FALSE. A
    -- concurrent claimant holds the row lock until it commits; we then see
    -- has_received = TRUE, claim nothing (v_claimed stays NULL), and loop.
    v_claimed := NULL;
    INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
    VALUES (v_receiver_id, v_receiver_date, FALSE, TRUE)
    ON CONFLICT (user_id, date)
    DO UPDATE SET has_received = TRUE
    WHERE daily_quotas.has_received = FALSE
    RETURNING user_id INTO v_claimed;

    IF v_claimed IS NOT NULL THEN
      EXIT; -- quota claimed — this receiver is ours alone
    END IF;
  END LOOP;

  -- Commit the match. The FOR UPDATE lock guarantees received_at is still
  -- NULL; the claimed quota row guarantees the receiver is exclusively ours.
  -- Same transaction: both commit or neither.
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

-- ── 2. get_today_bottle_status: receivedBottle by receiver-local receive date ─
-- Verbatim copy of migration 019 except: the receiver's timezone is resolved
-- once, and receivedBottle filters on received_at in that timezone instead of
-- day_key (the sender's throw date).
CREATE OR REPLACE FUNCTION public.get_today_bottle_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v_tz TEXT;
  today DATE;
  v_quota JSONB;
  v_sent JSONB;
  v_received JSONB;
  v_sailing JSONB;
  v_unacked JSONB;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz
  FROM public.profiles WHERE id = uid;
  v_tz := COALESCE(v_tz, 'UTC');
  today := (now() AT TIME ZONE v_tz)::date;

  SELECT to_jsonb(q) INTO v_quota
  FROM (
    SELECT user_id, date, has_sent, has_received
    FROM public.daily_quotas
    WHERE user_id = uid AND date = today
  ) q;

  -- Sent bottle: own sent metadata. receiver_id intentionally omitted.
  SELECT to_jsonb(s) INTO v_sent
  FROM (
    SELECT id, message, sent_at, received_at, day_key, is_stale
    FROM public.bottles
    WHERE sender_id = uid AND day_key = today
    LIMIT 1
  ) s;

  -- Received bottle: sender_id intentionally omitted. Filtered by the
  -- RECEIVE time falling on the receiver's local day — day_key is the
  -- sender's throw date and (with the 1-hour rule + multi-day drift) almost
  -- never equals the receiver's "today".
  SELECT to_jsonb(r) INTO v_received
  FROM (
    SELECT id, message, sent_at, received_at, read_at, day_key,
           is_read, is_reported, is_stale
    FROM public.bottles
    WHERE receiver_id = uid
      AND received_at IS NOT NULL
      AND is_stale = FALSE
      AND (received_at AT TIME ZONE v_tz)::date = today
    ORDER BY received_at DESC
    LIMIT 1
  ) r;

  -- Sailing bottles: unmatched, capped at 21.
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_sailing
  FROM (
    SELECT id, message, sent_at, day_key
    FROM public.bottles
    WHERE sender_id = uid
      AND received_at IS NULL
      AND is_stale = FALSE
    ORDER BY sent_at DESC
    LIMIT 21
  ) x;

  -- Delivered but not yet acknowledged. INTENTIONAL: NOT filtered by day_key —
  -- the toast must surface a delivery whenever it happened. Do not "fix".
  SELECT COALESCE(jsonb_agg(to_jsonb(u)), '[]'::jsonb) INTO v_unacked
  FROM (
    SELECT id, sent_at, received_at, day_key
    FROM public.bottles
    WHERE sender_id = uid
      AND received_at IS NOT NULL
      AND delivered_ack_at IS NULL
    ORDER BY received_at DESC
  ) u;

  RETURN jsonb_build_object(
    'quota', COALESCE(v_quota, jsonb_build_object(
      'user_id', uid,
      'date', today,
      'has_sent', FALSE,
      'has_received', FALSE
    )),
    'sentBottle', v_sent,
    'receivedBottle', v_received,
    'sailingBottles', v_sailing,
    'unackedDelivered', v_unacked
  );
END;
$$;

-- ── 3. retry_unmatched_bottles: also re-fire orphaned notification emails ────
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
BEGIN
  BEGIN
    v_supabase_url     := current_setting('app.settings.supabase_url', true);
    v_service_role_key := current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    v_supabase_url     := NULL;
    v_service_role_key := NULL;
  END;

  v_notify_url := CASE
    WHEN v_supabase_url IS NOT NULL
    THEN v_supabase_url || '/functions/v1/notify-receiver'
    ELSE NULL
  END;

  FOR v_id IN
    SELECT id
    FROM   public.bottles
    WHERE  received_at IS NULL
      AND  is_stale    = FALSE
    ORDER BY random()
  LOOP
    v_result := public.match_bottle(v_id);

    -- Fire notification only on a fresh match (a receiver was assigned now).
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
  END LOOP;

  -- Second pass: matched bottles whose notification email never landed —
  -- either the claim was released after a Resend failure, or the original
  -- pg_net call was lost. notify-receiver's claim-before-send (migration 010)
  -- makes re-firing idempotent. 10-minute grace excludes bottles matched in
  -- this run / seconds ago; 7-day window bounds the retry. The opt-out join
  -- only avoids wasted invocations — the edge function re-checks and a
  -- receiver who re-enables notifications is picked up on the next tick.
  IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
    FOR v_id IN
      SELECT b.id
      FROM   public.bottles b
      JOIN   public.profiles p ON p.id = b.receiver_id
      WHERE  b.received_at IS NOT NULL
        AND  b.email_notified_at IS NULL
        AND  b.is_stale = FALSE
        AND  p.email_notifications = TRUE
        AND  b.received_at < now() - interval '10 minutes'
        AND  b.received_at > now() - interval '7 days'
    LOOP
      PERFORM net.http_post(
        url     := v_notify_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || v_service_role_key
                   ),
        body    := jsonb_build_object('bottle_id', v_id)
      );
    END LOOP;
  END IF;

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Every-15-min retry: (1) iterate unmatched non-stale bottles in random order '
  'and delegate each to match_bottle() (migration 026 — claim-first, race-free), '
  'firing notify-receiver via pg_net for each fresh match; (2) re-fire '
  'notify-receiver for matched bottles still missing email_notified_at '
  '(released claim / lost call), 10min–7d window. Called by pg_cron job '
  '''retry-unmatched-bottles''.';
