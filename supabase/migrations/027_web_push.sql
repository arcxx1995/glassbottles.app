-- Migration 027: Web Push — the "your bottle was found" notification
--
-- WHY:
--   Phase 1 headline retention hook. The highest-emotion moment in the app is
--   "someone, somewhere, read your words." Email (notify-receiver) tells the
--   RECEIVER a bottle arrived; this adds a browser push to BOTH parties via the
--   same matcher path. Web Push reaches logged-out users (PWA installed to the
--   home screen — iOS 16.4+ requires that), at zero per-message cost, owning the
--   re-engagement surface.
--
-- ARCHITECTURE:
--   - push_subscriptions stores each browser's PushManager endpoint + keys.
--   - The retry cron (the single matcher chokepoint, migration 019) fires a new
--     push-notify Edge Function via pg_net for every freshly matched bottle,
--     exactly alongside the existing notify-receiver email call. push-notify
--     looks up the receiver's (and sender's) subscriptions and sends the VAPID
--     push. No new column on bottles — a duplicate push across cron ticks is
--     impossible because notify fires only on the fresh-match transition.
--
-- REQUIRED CONFIG (set before this does anything — see CLAUDE.md / push-notify):
--   - DB settings already present for email: app.settings.supabase_url,
--     app.settings.service_role_key (reused here).
--   - Edge Function secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
--   - Client build env: NEXT_PUBLIC_VAPID_PUBLIC_KEY.

CREATE TABLE public.push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.push_subscriptions IS
  'One row per browser/device push endpoint. Written by the save/delete RPCs; '
  'read by the push-notify Edge Function (service role). endpoint is the natural '
  'key — re-subscribing the same browser upserts.';

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT USING (user_id = auth.uid());
-- Writes via RPC only (service role reads in the Edge Function bypass RLS).

-- ── save_push_subscription(): upsert this browser's endpoint ────────────────
CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_endpoint TEXT,
  p_p256dh   TEXT,
  p_auth     TEXT
)
RETURNS VOID
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
  IF COALESCE(btrim(p_endpoint), '') = '' THEN
    RAISE EXCEPTION 'endpoint required' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
  VALUES (p_endpoint, uid, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id   = EXCLUDED.user_id,   -- re-bind if the device changed accounts
    p256dh    = EXCLUDED.p256dh,
    auth      = EXCLUDED.auth,
    last_seen = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) TO authenticated;

-- ── delete_push_subscription(): unsubscribe this browser ────────────────────
CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Scoped to the caller so one user can't delete another's subscription.
  DELETE FROM public.push_subscriptions
  WHERE endpoint = p_endpoint AND user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) TO authenticated;

-- ── Extend the matcher cron to fire push-notify alongside notify-receiver ───
-- Identical to migration 019 except for v_push_url + the second http_post in the
-- fresh-match branch. Append-only: this CREATE OR REPLACE supersedes 019's body.
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
  v_push_url         TEXT;
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
  v_push_url := CASE
    WHEN v_supabase_url IS NOT NULL
    THEN v_supabase_url || '/functions/v1/push-notify'
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

    IF COALESCE((v_result ->> 'matched')::boolean, false)
       AND (v_result ? 'receiver_id') THEN
      v_matched_count := v_matched_count + 1;

      IF v_service_role_key IS NOT NULL THEN
        -- Email the receiver (idempotent via email_notified_at).
        IF v_notify_url IS NOT NULL THEN
          PERFORM net.http_post(
            url     := v_notify_url,
            headers := jsonb_build_object(
                         'Content-Type',  'application/json',
                         'Authorization', 'Bearer ' || v_service_role_key
                       ),
            body    := jsonb_build_object('bottle_id', v_id)
          );
        END IF;
        -- Push both parties ("your bottle was found" / "a bottle arrived").
        IF v_push_url IS NOT NULL THEN
          PERFORM net.http_post(
            url     := v_push_url,
            headers := jsonb_build_object(
                         'Content-Type',  'application/json',
                         'Authorization', 'Bearer ' || v_service_role_key
                       ),
            body    := jsonb_build_object('bottle_id', v_id)
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN v_matched_count;
END;
$$;

COMMENT ON FUNCTION public.retry_unmatched_bottles() IS
  'Hourly/15-min retry: delegate each unmatched bottle to match_bottle(), then '
  'fire notify-receiver (email) AND push-notify (web push) via pg_net for each '
  'freshly matched bottle. Supersedes migration 019.';
