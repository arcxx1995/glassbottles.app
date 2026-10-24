-- Migration 054: a per-user rate limit on the live filter
--
-- check-message (052) calls precheck_message() first on every draft check,
-- before any model call, so the count lives here: 60 checks per user per
-- 10-minute window. A writer pausing over one bottle uses ~5–15; a script
-- hammering the endpoint stops at 60 and never reaches the model.
-- Over the limit raises 'rate_limited'; the raise rolls the increment back,
-- so the count stays at the cap until the window ends.
-- ponytail: fixed window, so a burst can straddle two windows (≤120 in 10
-- min); a sliding window if that ever matters.

CREATE TABLE IF NOT EXISTS public.check_rate (
  user_id      UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  n            INT NOT NULL
);
ALTER TABLE public.check_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.check_rate FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.check_rate TO service_role;

-- 052 body plus the count; VOLATILE now that it writes.
CREATE OR REPLACE FUNCTION public.precheck_message(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v_p RECORD;
  v_n INT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.check_rate AS c (user_id, window_start, n)
  VALUES (uid, now(), 1)
  ON CONFLICT (user_id) DO UPDATE SET
    window_start = CASE WHEN c.window_start < now() - interval '10 minutes'
                        THEN now() ELSE c.window_start END,
    n            = CASE WHEN c.window_start < now() - interval '10 minutes'
                        THEN 1 ELSE c.n + 1 END
  RETURNING n INTO v_n;
  IF v_n > 60 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
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
