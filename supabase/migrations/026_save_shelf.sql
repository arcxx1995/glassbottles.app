-- Migration 026: the save shelf — keep + revisit received bottles
--
-- WHY:
--   Phase 1 of the product spec. Received bottles are ephemeral; people screenshot
--   the words that helped and lose them in their camera roll. The shelf is a
--   private keepsake: tap to keep a received bottle, revisit it on a bad day.
--   Free tier keeps up to SAVE_FREE_CAP; the paywall is on *memory storage*, never
--   on connection. (Plus = unlimited, enforced later via a profile flag.)
--
-- SCOPE / ANONYMITY:
--   Only bottles the user RECEIVED can be saved (you keep words a stranger sent
--   you). get_saved_bottles() returns the same anonymity-safe column set as the
--   inbox RPC (migration 014) — sender_id never leaves the database.

CREATE TABLE public.saved_bottles (
  user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bottle_id UUID NOT NULL REFERENCES public.bottles(id) ON DELETE CASCADE,
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bottle_id)
);
COMMENT ON TABLE public.saved_bottles IS
  'Private keepsake shelf: received bottles a user chose to keep. Free tier capped '
  'at SAVE_FREE_CAP in save_bottle(); writes go through the RPCs only.';

CREATE INDEX idx_saved_bottles_user ON public.saved_bottles(user_id, saved_at DESC);

ALTER TABLE public.saved_bottles ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_bottles_select_own ON public.saved_bottles
  FOR SELECT USING (user_id = auth.uid());
-- No INSERT/DELETE policy: the SECURITY DEFINER RPCs below are the only writers.

-- ── save_bottle(): keep a received bottle, enforcing the free cap ───────────
CREATE OR REPLACE FUNCTION public.save_bottle(p_bottle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid           UUID := auth.uid();
  SAVE_FREE_CAP CONSTANT INTEGER := 3;
  v_is_receiver BOOLEAN;
  v_already     BOOLEAN;
  v_count       INTEGER;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Only a bottle this user received may be shelved.
  SELECT EXISTS (
    SELECT 1 FROM public.bottles
    WHERE id = p_bottle_id AND receiver_id = uid
  ) INTO v_is_receiver;
  IF NOT v_is_receiver THEN
    RAISE EXCEPTION 'Bottle not found' USING ERRCODE = '42501';
  END IF;

  v_already := EXISTS (
    SELECT 1 FROM public.saved_bottles
    WHERE user_id = uid AND bottle_id = p_bottle_id
  );
  IF v_already THEN
    SELECT COUNT(*) INTO v_count FROM public.saved_bottles WHERE user_id = uid;
    RETURN jsonb_build_object('saved', TRUE, 'capped', FALSE, 'saved_count', v_count);
  END IF;

  -- Free-tier cap: refuse without erroring so the UI can show the upsell.
  SELECT COUNT(*) INTO v_count FROM public.saved_bottles WHERE user_id = uid;
  IF v_count >= SAVE_FREE_CAP THEN
    RETURN jsonb_build_object(
      'saved', FALSE, 'capped', TRUE, 'saved_count', v_count, 'cap', SAVE_FREE_CAP
    );
  END IF;

  INSERT INTO public.saved_bottles (user_id, bottle_id)
  VALUES (uid, p_bottle_id)
  ON CONFLICT (user_id, bottle_id) DO NOTHING;

  SELECT COUNT(*) INTO v_count FROM public.saved_bottles WHERE user_id = uid;
  RETURN jsonb_build_object('saved', TRUE, 'capped', FALSE, 'saved_count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_bottle(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_bottle(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_bottle(UUID) TO authenticated;

COMMENT ON FUNCTION public.save_bottle(UUID) IS
  'Keep a received bottle on the shelf. Enforces the free cap (3) by returning '
  '{capped:true} rather than erroring. Only the receiver may save a bottle.';

-- ── unsave_bottle(): remove from the shelf ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.unsave_bottle(p_bottle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.saved_bottles
  WHERE user_id = uid AND bottle_id = p_bottle_id;

  SELECT COUNT(*) INTO v_count FROM public.saved_bottles WHERE user_id = uid;
  RETURN jsonb_build_object('saved', FALSE, 'saved_count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unsave_bottle(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unsave_bottle(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.unsave_bottle(UUID) TO authenticated;

-- ── get_saved_bottles(): the shelf (anonymity-safe columns only) ────────────
CREATE OR REPLACE FUNCTION public.get_saved_bottles()
RETURNS TABLE (
  id          UUID,
  message     TEXT,
  sent_at     TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  read_at     TIMESTAMPTZ,
  day_key     DATE,
  is_read     BOOLEAN,
  is_reported BOOLEAN,
  is_stale    BOOLEAN,
  saved_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.message, b.sent_at, b.received_at, b.read_at,
         b.day_key, b.is_read, b.is_reported, b.is_stale, s.saved_at
  FROM public.saved_bottles s
  JOIN public.bottles b ON b.id = s.bottle_id
  WHERE s.user_id = auth.uid()
  ORDER BY s.saved_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_saved_bottles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_saved_bottles() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_saved_bottles() TO authenticated;

COMMENT ON FUNCTION public.get_saved_bottles() IS
  'The shelf: a user''s saved received bottles, newest first, anonymity-safe '
  'columns only (sender_id never leaves the DB).';
