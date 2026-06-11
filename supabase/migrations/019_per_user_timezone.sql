-- Migration 019: per-user local-midnight day model (debug report bug 6)
--
-- The "daily" boundary was hard-pinned to UTC midnight everywhere, while
-- profiles.timezone was stored but never read. A user in UTC+13 reset at 1 PM
-- local. This migration makes the day boundary per-user-local, anchored on
-- profiles.timezone via the user_local_date() / user_local_today() helpers
-- (migration 017).
--
-- THE DAY MODEL after this migration:
--   * A bottle's day_key = the SENDER's local date (gates "sent today" + the
--     UNIQUE(sender_id, day_key) one-per-day-sent constraint).
--   * A daily_quotas row's date = the OWNER's local date. Sender rows are keyed
--     to the sender's local day; receiver rows (written by match_bottle) to the
--     receiver's local day. These can differ — a bottle thrown on the sender's
--     Tuesday can be received on the receiver's Wednesday. That is correct:
--     each user's "one per day" is measured in their own timezone.
--   * The ambient global counter (get_todays_bottle_count) stays UTC — it is
--     non-quota social proof, and a single global "today" is the sensible
--     definition for an ocean-wide count.

-- ── 1. bottle.day_key defaults to the sender's local date ───────────────────
-- auth.uid() resolves to the inserting user; the send route no longer passes
-- day_key explicitly, so this default is authoritative and matches the RLS
-- quota check and the UNIQUE constraint (all derive from the same expression).
ALTER TABLE public.bottles
  ALTER COLUMN day_key SET DEFAULT public.user_local_date(auth.uid());

-- ── 2. RLS INSERT quota check → sender-local day ────────────────────────────
DROP POLICY IF EXISTS "bottles: sender inserts with quota check" ON public.bottles;
CREATE POLICY "bottles: sender inserts with quota check" ON public.bottles
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND NOT EXISTS (
      SELECT 1 FROM public.daily_quotas
      WHERE user_id = auth.uid()
        AND date = public.user_local_date(auth.uid())
        AND has_sent = TRUE
    )
  );

-- ── 3. get_today_bottle_status(): "today" → caller's local date ─────────────
-- Verbatim copy of migration 016 with one change: `today` is now the caller's
-- local date instead of the UTC date.
CREATE OR REPLACE FUNCTION public.get_today_bottle_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  today DATE := public.user_local_date(auth.uid());
  v_quota JSONB;
  v_sent JSONB;
  v_received JSONB;
  v_sailing JSONB;
  v_unacked JSONB;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

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

  -- Received bottle: sender_id intentionally omitted.
  SELECT to_jsonb(r) INTO v_received
  FROM (
    SELECT id, message, sent_at, received_at, read_at, day_key,
           is_read, is_reported, is_stale
    FROM public.bottles
    WHERE receiver_id = uid AND day_key = today
    LIMIT 1
  ) r;

  -- Sailing bottles: unmatched, capped at 21 (cap gates the throw entry —
  -- see migration 012 / home page logic).
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

  -- Delivered but not yet acknowledged — drives the persistent
  -- "Your bottle found someone" toast. No receiver information.
  -- INTENTIONAL: NOT filtered by day_key. The ack is durable and the toast
  -- must surface a delivery whenever it happened (e.g. a bottle thrown days ago
  -- and matched today by the retry cron), not only "today's" deliveries.
  -- Do not "fix" this by adding `AND day_key = today`.
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

-- ── 4. retry_unmatched_bottles(): delegate to match_bottle() ────────────────
-- Replaces the bespoke matching loop (migration 013) so the cron and the edge
-- function share ONE matcher — eliminating divergence and inheriting the
-- per-user-local receiver eligibility from match_bottle() (migration 017).
-- Email notification (pg_net) fires only for freshly matched bottles.
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

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Hourly retry: iterate unmatched non-stale bottles in random order and '
  'delegate each to match_bottle() (migration 017), then fire notify-receiver '
  'via pg_net for each freshly matched bottle. Called by pg_cron job '
  '''retry-unmatched-bottles'' (migration 006).';
