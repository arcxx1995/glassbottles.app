-- Migration 037: the receiver notification email retries until it lands
--
-- WHY:
--   The email pipeline was silently dead from launch until 2026-07-11 (see the
--   034 forensics). The config bug is fixed and prod is healthy — every
--   delivery since has been emailed within seconds. What is NOT fixed is the
--   recovery path: the retry pass in retry_unmatched_bottles() only looks at
--   bottles matched in the last 7 days.
--
--     received_at > now() - interval '7 days'
--
--   So an outage lasting longer than a week (the exact shape of the one we
--   had) strands every bottle it touched, permanently, and the only cure is a
--   human noticing and running backfill_notify_emails() by hand. An automatic
--   system that needs a human to notice is not automatic.
--
-- FIX:
--   Drop the 7-day window. The 8-attempt cap (033) already bounds the work per
--   bottle — a permanently bouncing address still stops after 8 tries — so the
--   window was only ever protecting against a burst, not against runaway
--   retries. Replace it with an explicit per-tick LIMIT, which protects
--   against the burst properly: Resend rate-limits around 2 req/s and pg_net
--   dispatches a tick's posts together, so 20 per 15-minute tick is well
--   inside the budget while draining any conceivable backlog within hours.
--   Oldest and least-tried first, so nothing starves.
--
--   This makes backfill_notify_emails() redundant for future incidents — it
--   stays for manual one-offs, but the cron now does its job unaided.
--
-- The rest of the body is verbatim migration 036 (advisory lock, 1-hour
-- prefilter, per-bottle fault isolation, Vault config).

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
  -- One run at a time (036). Transaction-scoped: cannot leak.
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
  FOR v_id IN
    SELECT id
    FROM   public.bottles
    WHERE  received_at IS NULL
      AND  is_stale    = FALSE
      AND  sent_at    <= now() - interval '1 hour'   -- 022 rule, checked early (036)
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

  -- ── Pass 2: any matched bottle whose email never landed, at any age ───────
  -- notify-receiver claims email_notified_at BEFORE sending (010), so
  -- re-firing is idempotent; a 4xx releases the claim and a 5xx keeps it
  -- (missed beats duplicate). Bottles whose receiver opted out are skipped
  -- here and would not be sent anyway — the edge function re-checks — and a
  -- receiver who re-enables notifications is picked up on the next tick,
  -- however old the bottle is.
  IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
    FOR v_id IN
      SELECT b.id
      FROM   public.bottles b
      JOIN   public.profiles p ON p.id = b.receiver_id
      WHERE  b.received_at IS NOT NULL
        AND  b.email_notified_at IS NULL
        AND  b.email_retry_count < 8
        AND  p.email_notifications = TRUE
        AND  b.received_at < now() - interval '10 minutes'
      ORDER BY b.email_retry_count ASC, b.received_at ASC
      LIMIT  20   -- Resend ≈2 req/s; a tick's posts dispatch together
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

    -- Visible backlog signal. A tick that leaves work behind says so, so a
    -- backlog cannot sit unnoticed for three weeks again.
    SELECT count(*) INTO v_pending
    FROM   public.bottles b
    JOIN   public.profiles p ON p.id = b.receiver_id
    WHERE  b.received_at IS NOT NULL
      AND  b.email_notified_at IS NULL
      AND  b.email_retry_count < 8
      AND  p.email_notifications = TRUE
      AND  b.received_at < now() - interval '10 minutes';
    IF v_pending > 0 THEN
      RAISE WARNING 'retry_unmatched_bottles: % notification email(s) still pending after this tick', v_pending;
    END IF;
  END IF;

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Every-15-min retry, single-flight via advisory lock (036): (1) match adrift '
  'bottles older than 1 hour, firing notify-receiver per fresh match; (2) '
  're-fire notify-receiver for ANY matched bottle still missing '
  'email_notified_at — no age window (037), 20 per tick, capped at 8 attempts '
  'per bottle (033). Config from GUC or Vault via _notify_config() (034).';

-- ── Health check: is the pipeline actually delivering? ───────────────────────
-- Extends 034's config presence check with the two numbers that would have
-- exposed the July outage on day one: when an email last went out, and how
-- many are waiting. Booleans and counts only — never secret values.
CREATE OR REPLACE FUNCTION public.notify_config_status()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'url_set', EXISTS (
      SELECT 1 FROM vault.secrets WHERE name = 'app.settings.supabase_url'),
    'key_set', EXISTS (
      SELECT 1 FROM vault.secrets WHERE name = 'app.settings.service_role_key'),
    -- Every matched bottle with no email stamp, opt-outs included (the 034
    -- version also filtered is_stale, which hid orphans while the retention
    -- bug was live — see 035).
    'email_orphans', (
      SELECT count(*) FROM public.bottles
      WHERE received_at IS NOT NULL AND email_notified_at IS NULL),
    -- Orphans the cron will actually retry: receiver still wants email and the
    -- attempt cap is not spent. This is the number that must trend to zero.
    'email_retryable', (
      SELECT count(*) FROM public.bottles b
      JOIN public.profiles p ON p.id = b.receiver_id
      WHERE b.received_at IS NOT NULL AND b.email_notified_at IS NULL
        AND b.email_retry_count < 8 AND p.email_notifications = TRUE),
    'last_email_sent_at', (
      SELECT max(email_notified_at) FROM public.bottles),
    'last_delivery_at', (
      SELECT max(received_at) FROM public.bottles)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.notify_config_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_config_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_config_status() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.notify_config_status() TO service_role;

COMMENT ON FUNCTION public.notify_config_status() IS
  'Email pipeline health: config presence, orphan + retryable counts, last '
  'email sent, last delivery. If last_delivery_at is recent and '
  'last_email_sent_at is not, the pipeline is down. Service role only.';
