-- Migration 046: sparks — a question to start from
--
-- "Need a spark?" offers one gentle question to write from. It never writes
-- the bottle: one honest message stays the writer's own. Everyone gets the
-- static deck (in the app); Keepers get questions from Claude, tuned to the
-- sky and current they chose, five a day. The spark Edge Function spends one
-- through use_spark() as the signed-in user, so the cap and the membership
-- are checked here, not in the function.

ALTER TABLE public.daily_quotas
  ADD COLUMN IF NOT EXISTS sparks_used INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.use_spark()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid   UUID := auth.uid();
  today DATE := public.user_local_date(auth.uid());
  used  INT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_keeper(uid) THEN
    RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
  END IF;

  -- Atomic: the WHERE on the conflict branch is the cap, so two quick taps
  -- can't both take the fifth spark.
  INSERT INTO public.daily_quotas (user_id, date, sparks_used)
  VALUES (uid, today, 1)
  ON CONFLICT (user_id, date) DO UPDATE
    SET sparks_used = daily_quotas.sparks_used + 1
    WHERE daily_quotas.sparks_used < 5
  RETURNING sparks_used INTO used;

  IF used IS NULL THEN
    RAISE EXCEPTION 'spark_limit' USING ERRCODE = '54000';
  END IF;
  RETURN 5 - used; -- sparks left today
END;
$$;

REVOKE EXECUTE ON FUNCTION public.use_spark() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.use_spark() TO authenticated;
