-- Migration 017: atomic match_bottle() RPC + per-user local-date helpers
--
-- Replaces the JS matching logic in the match-bottle edge function, which had
-- four defects (debug report bugs 1–4):
--
--   1. Lost-race quota burn: the edge fn's UPDATE `.is('received_at', null)`
--      returned no error on 0 rows, so a receiver's daily_quotas.has_received
--      was set TRUE even when the bottle was already matched by a concurrent
--      caller — silently locking that receiver out for the day.
--   2. Quota/match desync: the quota upsert error was unchecked and ran in a
--      separate statement from the match UPDATE — a failure left the bottle
--      matched but the receiver eligible for a SECOND bottle the same day.
--   3. Biased selection: `.limit(20)` + JS Math.random() never matched
--      receivers past the first 20 eligible profiles in physical order.
--   4. Unbounded exclusion: `.not('id','in','(<every receiver today>)')` grew
--      the querystring linearly with DAU until it blew past URL limits.
--
-- THE FIX — one transactional SECURITY DEFINER function:
--   * SELECT ... FOR UPDATE locks the bottle row → concurrent callers serialize;
--     the loser sees received_at set and returns 'already matched' (bug 1, 2).
--   * Match UPDATE + receiver quota INSERT run in the same transaction — both
--     commit or neither does (bug 2).
--   * ORDER BY random() over the full eligible set (bug 3).
--   * NOT EXISTS correlated subquery instead of an IN list — O(1) query size
--     regardless of how many users received today (bug 4).
--
-- Both the edge-function path and the pg_cron retry path (migration 019) call
-- this single function, so the two matchers can no longer diverge.

-- ── Helper: a user's current LOCAL date, from profiles.timezone ──────────────
-- SECURITY INVOKER: when called by `authenticated` for another user's id, the
-- inner SELECT is RLS-filtered to NULL → COALESCE to 'UTC'. No tz leak. When
-- called inside a SECURITY DEFINER function (the matcher) it runs as the
-- definer and can read any profile's timezone.
CREATE OR REPLACE FUNCTION public.user_local_date(p_user UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.profiles WHERE id = p_user),
    'UTC'
  ))::date;
$$;

GRANT EXECUTE ON FUNCTION public.user_local_date(UUID) TO authenticated;

-- ── Helper: the CALLER's local date (for RLS policies and client RPCs) ──────
CREATE OR REPLACE FUNCTION public.user_local_today()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.user_local_date(auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.user_local_today() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_local_today() FROM anon;
GRANT EXECUTE ON FUNCTION public.user_local_today() TO authenticated;

-- ── Atomic single-bottle matcher ────────────────────────────────────────────
-- Returns JSONB describing the outcome:
--   { matched:true, receiver_id, bottle_id }       — freshly matched by us
--   { matched:true, reason:'already matched' }      — idempotent no-op
--   { matched:false, queued:true, reason:... }      — no eligible receiver
--   { matched:false, reason:'not found' }           — bad bottle_id
-- The caller (edge fn / retry cron) fires the email notification ONLY when a
-- receiver_id is present (a fresh match), never on the idempotent path.
CREATE OR REPLACE FUNCTION public.match_bottle(p_bottle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bottle      RECORD;
  v_receiver_id UUID;
BEGIN
  -- Lock the bottle row for the duration of the transaction. Concurrent
  -- match attempts (edge fn vs cron, or double-send) serialize here.
  SELECT id, sender_id, received_at
  INTO   v_bottle
  FROM   public.bottles
  WHERE  id = p_bottle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not found');
  END IF;

  -- Idempotent: already matched (by us previously, or by a concurrent caller
  -- that won the row lock). Never touches quota — fixes the lost-race burn.
  IF v_bottle.received_at IS NOT NULL THEN
    RETURN jsonb_build_object('matched', true, 'reason', 'already matched');
  END IF;

  -- Eligible receiver: not the sender, and has not already received a bottle
  -- on THEIR OWN local day (per-user timezone — debug report bug 6). Random
  -- order over the full set; NOT EXISTS keeps query size constant under load.
  SELECT p.id
  INTO   v_receiver_id
  FROM   public.profiles p
  WHERE  p.id <> v_bottle.sender_id
    AND  NOT EXISTS (
           SELECT 1
           FROM   public.daily_quotas dq
           WHERE  dq.user_id      = p.id
             AND  dq.date         = public.user_local_date(p.id)
             AND  dq.has_received = TRUE
         )
  ORDER BY random()
  LIMIT 1;

  IF v_receiver_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', false, 'queued', true, 'reason', 'no eligible receiver'
    );
  END IF;

  -- Commit point. The FOR UPDATE lock guarantees received_at is still NULL.
  UPDATE public.bottles
  SET    receiver_id = v_receiver_id,
         received_at = now()
  WHERE  id = p_bottle_id;

  -- Receiver quota keyed to the RECEIVER's local day — NOT the sender's
  -- bottle.day_key. Same transaction as the match: both or neither (bug 2).
  INSERT INTO public.daily_quotas (user_id, date, has_sent, has_received)
  VALUES (v_receiver_id, public.user_local_date(v_receiver_id), FALSE, TRUE)
  ON CONFLICT (user_id, date)
  DO UPDATE SET has_received = TRUE;

  RETURN jsonb_build_object(
    'matched', true,
    'receiver_id', v_receiver_id,
    'bottle_id', p_bottle_id
  );
END;
$$;

-- Trusted callers only: the match-bottle edge fn (service role) and the
-- retry cron (SECURITY DEFINER, owned by postgres). Never client-callable.
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_bottle(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.match_bottle(UUID) TO service_role;
