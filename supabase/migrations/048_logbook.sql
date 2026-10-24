-- Migration 048: the Logbook
--
-- Everything you threw, everything that found you, and your letters to
-- yourself, in one keepsake. A Keeper perk that stays readable after the
-- membership ends (the lapse rule: what exists stays) — so anyone who has
-- ever been a Keeper can open it; exporting it needs an active one (app).
-- Held bottles never sailed and are left out; strangers stay anonymous.

CREATE OR REPLACE FUNCTION public.get_logbook()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.memberships WHERE user_id = uid) THEN
    RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'sent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'message', message, 'at', sent_at, 'found', received_at IS NOT NULL,
               'rippled', rippled_at IS NOT NULL, 'style', style,
               'weather', weather, 'vibe', vibe, 'current', current)
             ORDER BY sent_at)
      FROM public.bottles
      WHERE sender_id = uid AND screen IS DISTINCT FROM 'held'), '[]'::jsonb),
    'received', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'message', message, 'at', received_at, 'kept', kept_at IS NOT NULL,
               'style', style, 'weather', weather, 'vibe', vibe, 'current', current)
             ORDER BY received_at)
      FROM public.bottles
      WHERE receiver_id = uid AND received_at IS NOT NULL AND is_reported IS NOT TRUE), '[]'::jsonb),
    'future', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'message', message, 'at', delivered_at, 'written', created_at,
               'style', style, 'weather', weather)
             ORDER BY delivered_at)
      FROM public.future_bottles
      WHERE user_id = uid AND delivered_at IS NOT NULL), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_logbook() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_logbook() TO authenticated;
