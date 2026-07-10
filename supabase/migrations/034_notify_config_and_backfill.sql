-- Migration 034: notify config via Vault + backfill orphaned notification emails
--
-- FORENSICS (2026-07-11): retry_unmatched_bottles() (011→033) guards every
-- notify-receiver post on current_setting('app.settings.supabase_url' /
-- 'app.settings.service_role_key', true). Migration 011's comment claimed the
-- platform sets these — it does not, and no migration ever did. The guard was
-- silently false since launch: 36/37 matched bottles never got their email
-- (email_retry_count = 0 even inside the retry window proves the guard, not
-- HTTP, was the failure). 32 of them also aged past the 7-day second-pass
-- window (033), so the cron will never pick them up on its own.
--
-- WHY VAULT (not ALTER DATABASE SET): setting a database-level custom GUC
-- requires superuser on PG15+ — Supabase's postgres role got "permission
-- denied to set parameter". Vault is the supported store: secrets are written
-- once via a service_role-only RPC (the key travels over TLS at call time,
-- never in migration text / git) and read via vault.decrypted_secrets.
--
-- PIECES:
--   1. _notify_config() — internal reader: GUC if ever present, else Vault.
--   2. set_notify_config(url, key) — service_role-only upsert into Vault.
--   3. retry_unmatched_bottles() — verbatim 033 body except: config comes from
--      _notify_config(), and a missing config now RAISE WARNINGs every run
--      instead of silently skipping (the failure mode that hid this for
--      3+ weeks).
--   4. backfill_notify_emails(p_limit) — the 033 second pass WITHOUT the
--      7-day window, batched so Resend's rate limit isn't tripped in one
--      burst (a 429 releases the claim; a later batch retries). Increments
--      email_retry_count before each post (same books as 033).
--   5. notify_config_status() — presence booleans + orphan count, no values.

-- ── 1. Internal config reader ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_config(OUT supabase_url TEXT, OUT service_role_key TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    supabase_url := COALESCE(
      current_setting('app.settings.supabase_url', true),
      (SELECT decrypted_secret FROM vault.decrypted_secrets
       WHERE name = 'app.settings.supabase_url'));
    service_role_key := COALESCE(
      current_setting('app.settings.service_role_key', true),
      (SELECT decrypted_secret FROM vault.decrypted_secrets
       WHERE name = 'app.settings.service_role_key'));
  EXCEPTION WHEN OTHERS THEN
    supabase_url     := NULL;
    service_role_key := NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_config() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._notify_config() FROM anon;
REVOKE EXECUTE ON FUNCTION public._notify_config() FROM authenticated;

-- ── 2. One-time config setter (Vault upsert) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_notify_config(p_url TEXT, p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_url IS NULL OR p_url !~ '^https://[a-z0-9]+\.supabase\.co$' THEN
    RAISE EXCEPTION 'invalid supabase url';
  END IF;
  -- Accept both key formats: new sb_secret_* (~41 chars) and legacy JWT (eyJ…).
  IF p_key IS NULL OR p_key !~ '^(sb_secret_|eyJ)' OR length(p_key) < 30 THEN
    RAISE EXCEPTION 'invalid service role key';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'app.settings.supabase_url';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_url, 'app.settings.supabase_url');
  ELSE
    PERFORM vault.update_secret(v_id, p_url);
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'app.settings.service_role_key';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_key, 'app.settings.service_role_key');
  ELSE
    PERFORM vault.update_secret(v_id, p_key);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_notify_config(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_notify_config(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_notify_config(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.set_notify_config(TEXT, TEXT) TO service_role;

-- ── 3. retry_unmatched_bottles: Vault-aware config + loud when missing ──────
-- Verbatim migration 033 body except the config block.
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
  SELECT c.supabase_url, c.service_role_key
  INTO   v_supabase_url, v_service_role_key
  FROM   public._notify_config() c;

  IF v_supabase_url IS NULL OR v_service_role_key IS NULL THEN
    -- Loud, every run: a silent skip here hid a dead email pipeline for
    -- 3+ weeks (matching still proceeds below).
    RAISE WARNING 'retry_unmatched_bottles: notify config missing — emails are '
                  'NOT being sent. Run set_notify_config().';
  END IF;

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
    -- Sub-transaction per bottle (032): one raising match must not roll back
    -- the whole run.
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'retry_unmatched_bottles: match_bottle(%) failed: %', v_id, SQLERRM;
    END;
  END LOOP;

  -- Second pass: matched bottles whose notification email never landed —
  -- released claim (Resend 4xx) or lost pg_net call. notify-receiver's
  -- claim-before-send makes re-firing idempotent. 10-minute grace excludes
  -- bottles matched in this run; 7-day window and the 8-attempt cap (033)
  -- bound the retry.
  IF v_notify_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
    FOR v_id IN
      SELECT b.id
      FROM   public.bottles b
      JOIN   public.profiles p ON p.id = b.receiver_id
      WHERE  b.received_at IS NOT NULL
        AND  b.email_notified_at IS NULL
        AND  b.is_stale = FALSE
        AND  b.email_retry_count < 8
        AND  p.email_notifications = TRUE
        AND  b.received_at < now() - interval '10 minutes'
        AND  b.received_at > now() - interval '7 days'
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
  END IF;

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Every-15-min retry: (1) iterate unmatched non-stale bottles in random order '
  'and delegate each to match_bottle() (029) inside a per-bottle exception '
  'sub-block (032), firing notify-receiver via pg_net for each fresh match; '
  '(2) re-fire notify-receiver for matched bottles still missing '
  'email_notified_at, 10min–7d window, capped at 8 attempts (033). Config from '
  'GUC or Vault via _notify_config(); missing config RAISE WARNINGs (034). '
  'Called by pg_cron job ''retry-unmatched-bottles''.';

-- ── 4. Orphaned-email backfill (no 7-day window) ────────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_notify_emails(p_limit INTEGER DEFAULT 5)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id               UUID;
  v_fired            INTEGER := 0;
  v_supabase_url     TEXT;
  v_service_role_key TEXT;
BEGIN
  SELECT c.supabase_url, c.service_role_key
  INTO   v_supabase_url, v_service_role_key
  FROM   public._notify_config() c;

  IF v_supabase_url IS NULL OR v_service_role_key IS NULL THEN
    RAISE EXCEPTION 'notify config missing — run set_notify_config() first';
  END IF;

  FOR v_id IN
    SELECT b.id
    FROM   public.bottles b
    JOIN   public.profiles p ON p.id = b.receiver_id
    WHERE  b.received_at IS NOT NULL
      AND  b.email_notified_at IS NULL
      AND  b.is_stale = FALSE
      AND  b.email_retry_count < 8
      AND  p.email_notifications = TRUE
      AND  b.received_at < now() - interval '10 minutes'
    ORDER BY b.email_retry_count ASC, b.received_at ASC
    LIMIT p_limit
  LOOP
    UPDATE public.bottles
    SET    email_retry_count = email_retry_count + 1
    WHERE  id = v_id;

    PERFORM net.http_post(
      url     := v_supabase_url || '/functions/v1/notify-receiver',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_service_role_key
                 ),
      body    := jsonb_build_object('bottle_id', v_id)
    );
    v_fired := v_fired + 1;
  END LOOP;

  RETURN v_fired;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_notify_emails(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_notify_emails(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.backfill_notify_emails(INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.backfill_notify_emails(INTEGER) TO service_role;

-- ── 5. Config presence check (booleans only, never values) ──────────────────
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
    'email_orphans', (
      SELECT count(*) FROM public.bottles
      WHERE received_at IS NOT NULL AND email_notified_at IS NULL
        AND is_stale = FALSE
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.notify_config_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_config_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_config_status() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.notify_config_status() TO service_role;

COMMENT ON FUNCTION public.set_notify_config(TEXT, TEXT) IS
  'One-time: upsert app.settings.supabase_url / service_role_key into Vault — '
  'the config retry_unmatched_bottles needs before posting to notify-receiver. '
  'Never set before migration 034 (silent-skip since launch).';
COMMENT ON FUNCTION public.backfill_notify_emails(INTEGER) IS
  'Manual batched re-fire of notify-receiver for matched bottles missing '
  'email_notified_at, ignoring the 7-day window of the 033 cron pass. '
  'Idempotent via notify-receiver claim-before-send; respects the 8-attempt cap.';
