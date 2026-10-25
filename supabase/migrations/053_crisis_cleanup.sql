-- Migration 053: the rest of the live-moderation audit (2026-10-25)
--
-- 052 reached prod before these were added to it, and an applied migration
-- never re-runs — so they live here.
-- 1. Explicit sexual words join the blocklist (051 left them to the
--    classifier; a payment-processor review showed that is not enough).
-- 2. Bottles delivered under the old crisis rule are pulled from inboxes,
--    and a pulled crisis bottle is never a strike.

-- ── 1. Explicit sexual words ──────────────────────────────────────────────────
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

-- ── 2. Old crisis deliveries: pulled, never strikes ───────────────────────────
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
