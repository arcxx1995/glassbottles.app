-- Migration 031: remove test-branch schema the working app has no use of.
--
-- Migrations 025–028 (mood/streak, save shelf, web push, reply threads) were
-- deployed to this database from the `test` branch, but the app that ships
-- from `main` contains none of that code. Product decision 2026-07-03: the
-- database must not carry stale schema the working app never touches — the
-- features return via their own (renumbered) migrations when their app code
-- actually ships. The 025–028 files stay in the repo as applied-history
-- records; this migration removes what they created.
--
-- Data at drop time: 1 mood check-in, 1 streak row, 1 pending thread — all
-- artifacts of staging tests on 2026-06-22. Nothing user-facing is lost.

-- ── 025: mood check-in + streak ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.check_in_mood(TEXT);
DROP FUNCTION IF EXISTS public.get_mood_streak_status();
DROP TABLE IF EXISTS public.mood_check_ins CASCADE;
DROP TABLE IF EXISTS public.user_streaks CASCADE;

-- ── 026: save shelf ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.save_bottle(UUID);
DROP FUNCTION IF EXISTS public.unsave_bottle(UUID);
DROP FUNCTION IF EXISTS public.get_saved_bottles();
DROP TABLE IF EXISTS public.saved_bottles CASCADE;

-- ── 027: web push ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.save_push_subscription(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.delete_push_subscription(TEXT);
DROP TABLE IF EXISTS public.push_subscriptions CASCADE;

-- ── 028: reply threads ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.initiate_thread(UUID);
DROP FUNCTION IF EXISTS public.accept_thread(UUID);
DROP FUNCTION IF EXISTS public.decline_thread(UUID);
DROP FUNCTION IF EXISTS public.send_thread_message(UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_threads();
DROP FUNCTION IF EXISTS public.get_thread_messages(UUID);
DROP FUNCTION IF EXISTS public.mark_thread_read(UUID);
-- Trigger functions (their triggers die with the tables; CASCADE for safety).
DROP FUNCTION IF EXISTS public.notify_thread_initiated() CASCADE;
DROP FUNCTION IF EXISTS public.notify_thread_accepted() CASCADE;
DROP FUNCTION IF EXISTS public.notify_thread_message() CASCADE;
DROP TABLE IF EXISTS public.thread_messages CASCADE;
DROP TABLE IF EXISTS public.threads CASCADE;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_plus;

-- ── retry_unmatched_bottles: back to email-only ──────────────────────────────
-- Verbatim migration 029 body minus the push-notify call (push_subscriptions
-- and the push-notify feature are gone; posting to it every fresh match was
-- dead pg_net traffic). Keeps 029's claim-first matcher delegation and the
-- orphaned-email second pass.
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
  -- released claim (Resend 4xx) or lost pg_net call. notify-receiver's
  -- claim-before-send makes re-firing idempotent. 10-minute grace excludes
  -- bottles matched in this run; 7-day window bounds the retry.
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
  'and delegate each to match_bottle() (migration 029 — claim-first, race-free), '
  'firing notify-receiver via pg_net for each fresh match; (2) re-fire '
  'notify-receiver for matched bottles still missing email_notified_at '
  '(released claim / lost call), 10min–7d window. Push-notify call removed in '
  '031 with the web-push schema. Called by pg_cron job ''retry-unmatched-bottles''.';
