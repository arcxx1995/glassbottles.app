-- Migration 052: crisis bottles stay ashore; a live check while typing
--
-- 1. A 'crisis' verdict (suicide / self-harm) no longer sails to a stranger.
--    It is held like any other hold, with reason 'crisis': out of the water,
--    the day's throw restored, the words returned to the writer (heldBottle in
--    get_today_bottle_status, ack_held_bottle) — and the writer is shown
--    helplines ('bottle_care'). No strike and no queue entry: it isn't a
--    violation, it's someone who may need help.
-- 2. precheck_message(text) — the account checks and blocklist from
--    guard_user_content(), callable by the signed-in user, so the
--    check-message edge function can tell the editor "this can't be sent"
--    while the person types, before anything is submitted.
-- 3. Explicit sexual words join the blocklist (051 left them to the
--    classifier; a payment-processor review showed that is not enough).
-- 4. Bottles delivered under the old crisis rule are pulled from inboxes,
--    and a pulled crisis bottle is never a strike.

-- ── 1. 'crisis' as a held reason ────────────────────────────────────────────
ALTER TABLE public.bottles DROP CONSTRAINT IF EXISTS bottles_screen_reason_check;
ALTER TABLE public.bottles ADD CONSTRAINT bottles_screen_reason_check
  CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam', 'minor', 'review', 'crisis'));

-- 051 body; the crisis verdict now takes the held path.
CREATE OR REPLACE FUNCTION public.apply_screen(
  p_bottle_id UUID,
  p_verdict   TEXT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_b public.bottles%ROWTYPE;
BEGIN
  -- 052: crisis is held, not delivered.
  IF p_verdict = 'crisis' THEN
    p_verdict := 'held';
    p_reason  := 'crisis';
  END IF;

  SELECT * INTO v_b FROM public.bottles WHERE id = p_bottle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_b.screen IS NOT NULL THEN
    RETURN 'already_screened'; -- pg_net may deliver twice
  END IF;

  -- 051: fail-closed matching makes this unreachable for new bottles; kept
  -- for bottles delivered before 051.
  IF p_verdict = 'held' AND v_b.received_at IS NOT NULL THEN
    UPDATE public.bottles SET screen = 'held', screen_reason = p_reason WHERE id = p_bottle_id;
    RETURN 'held_too_late';
  END IF;

  IF p_verdict = 'held' THEN
    -- The day's throw comes back, unless a bottle was already held today.
    IF NOT EXISTS (
      SELECT 1 FROM public.bottles
      WHERE sender_id = v_b.sender_id AND day_key = v_b.day_key
        AND screen = 'held' AND id <> p_bottle_id
    ) THEN
      UPDATE public.daily_quotas SET has_sent = FALSE
      WHERE user_id = v_b.sender_id AND date = v_b.day_key;
    END IF;
    UPDATE public.bottles
    SET screen = 'held', screen_reason = p_reason, is_stale = TRUE
    WHERE id = p_bottle_id;
    PERFORM realtime.send(jsonb_build_object('bottle_id', p_bottle_id),
                          CASE WHEN p_reason = 'crisis' THEN 'bottle_care' ELSE 'bottle_held' END,
                          'user:' || v_b.sender_id::text, true);
    IF p_reason IN ('minor', 'review') THEN
      PERFORM public.enqueue_moderation('bottle', p_bottle_id, 'screen', p_reason);
    END IF;
    IF p_reason IN ('sexual', 'harm', 'minor') THEN
      PERFORM public.record_strike(v_b.sender_id, p_reason);
    END IF;
    RETURN 'held';
  END IF;

  UPDATE public.bottles SET screen = p_verdict WHERE id = p_bottle_id;
  RETURN p_verdict;
END;
$$;

-- ── 2. precheck_message — guard_user_content(), before submitting ──────────
-- Raises the same errors the insert would; returns TRUE when the blocklist
-- matches. The term list itself stays unreadable.
CREATE OR REPLACE FUNCTION public.precheck_message(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v_p RECORD;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT suspended_at, age_confirmed_at INTO v_p FROM public.profiles WHERE id = uid;
  IF v_p.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'account_suspended' USING ERRCODE = '42501';
  END IF;
  IF v_p.age_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'age_unconfirmed' USING ERRCODE = '42501';
  END IF;
  RETURN public.violates_blocklist(p_text);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.precheck_message(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.precheck_message(TEXT) TO authenticated;

-- ── 3. Explicit sexual words ────────────────────────────────────────────────
-- ponytail: false positives ("pussy cat", a rooster) are accepted; the writer
-- is told why and can rephrase. Vents about porn are bounced too — by choice.
INSERT INTO public.blocked_terms (pattern) VALUES
  ('\mpuss(y|ies)\M'),
  ('\mcocks?\M'),
  ('\mcum(ming|s)?\M'),
  ('\mhorny\M'),
  ('\mporn\w*\M'),
  ('\m(tits|titties|boobs)\M'),
  ('\m(fuck|fucking|screw|bang)(ing)? (you|u|her|him|me) (hard|raw|senseless)\M'),
  ('\m(eat|lick|finger) (your|ur|her|my) (ass|out)\M')
ON CONFLICT DO NOTHING;

-- ── 4. Old crisis deliveries: pulled, never strikes ─────────────────────────
-- is_reported pulls them from the receiver's inbox, logbook, ripple and keep
-- (051); held_ack_at keeps a "your bottle was kept ashore" notice from
-- telling the sender something untrue about a bottle that was delivered.
UPDATE public.bottles
SET screen = 'held', screen_reason = 'crisis', is_stale = TRUE,
    is_reported = TRUE, held_ack_at = COALESCE(held_ack_at, now())
WHERE screen = 'crisis';

-- 051 body; a reported (pulled) crisis bottle no longer counts as a strike.
CREATE OR REPLACE FUNCTION public.record_strike(p_uid UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INT;
BEGIN
  IF p_uid IS NULL THEN
    RETURN;
  END IF;
  IF p_reason = 'minor' THEN
    PERFORM public.suspend_user(p_uid, 'minor');
    RETURN;
  END IF;
  SELECT
      (SELECT count(*) FROM public.bottles
       WHERE sender_id = p_uid AND sent_at > now() - interval '30 days'
         AND ((screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
              OR (is_reported AND screen_reason IS DISTINCT FROM 'crisis')))
    + (SELECT count(*) FROM public.posts
       WHERE author_id = p_uid AND created_at > now() - interval '30 days'
         AND screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
    + (SELECT count(*) FROM public.comments
       WHERE author_id = p_uid AND created_at > now() - interval '30 days'
         AND screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
    + (SELECT count(*) FROM public.scraps
       WHERE author_id = p_uid AND created_at > now() - interval '30 days'
         AND screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
    + (SELECT count(*) FROM public.moderation_queue
       WHERE kind IN ('post', 'comment', 'scrap', 'profile') AND source = 'report'
         AND reports >= 3 AND created_at > now() - interval '30 days'
         AND public.moderation_author(kind, target_id) = p_uid)
  INTO v_n;
  IF v_n >= 3 THEN
    PERFORM public.suspend_user(p_uid, 'repeated ' || p_reason);
  END IF;
END;
$$;
