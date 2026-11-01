-- Migration 063: Kayak voyages replace the daily twelve.
--
-- A Keeper builds up to 3 Kayaks, loads one with unique gems and a note, and
-- launches it. It visits one random paid member at a time. A visitor reads the
-- note and its anonymous guestbook, and takes one gem in exchange for a comment,
-- which sends the Kayak on. No gems left: it sails home to the mast.
--
-- Clients get no table grants. Every read and write is an RPC, and neither
-- owner ids nor author ids ever leave the database. A Kayak never links to its
-- owner's bottles.
--
-- Notes and comments get the bottle checks, not the weaker social ones: the
-- insert guard, the async screen (contact, crisis, classifier), fail-closed
-- after 6 misses, strikes, the admin queue.
--
-- Removes the 12-a-day feed and the @handle identity (055/056).

-- ─── the old Harbour goes ───────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pick-harbour') THEN
    PERFORM cron.unschedule('pick-harbour');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_harbour();
DROP FUNCTION IF EXISTS public.get_kayak_blocks();
DROP FUNCTION IF EXISTS public.save_kayak(TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.block_kayak(TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.report_kayak(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.pick_harbour(DATE);
DROP FUNCTION IF EXISTS public.kayak_in_pool(UUID);
DROP FUNCTION IF EXISTS public.kayak_afloat(UUID);
DROP FUNCTION IF EXISTS public.apply_social_screen(TEXT, UUID, TEXT, TEXT);
DROP TABLE IF EXISTS public.harbour_days;
DROP TABLE IF EXISTS public.kayaks;
DROP TABLE IF EXISTS public.social_profiles CASCADE;
DROP FUNCTION IF EXISTS public.reset_bio_screen();

-- kayak_blocks and kayak_reports stay: both are user to user.

-- ─── tables ─────────────────────────────────────────────────────────────────
CREATE TABLE public.kayaks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  look        JSONB NOT NULL,
  log_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX kayaks_owner_idx ON public.kayaks (owner_id);

-- screening → sailing ⇄ visiting → returning → home. A row in any state but
-- 'home' is the Kayak's one open voyage.
CREATE TABLE public.voyages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kayak_id          UUID NOT NULL REFERENCES public.kayaks(id) ON DELETE CASCADE,
  owner_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state             TEXT NOT NULL DEFAULT 'screening'
                    CHECK (state IN ('screening', 'sailing', 'visiting', 'returning', 'home')),
  sail_until        TIMESTAMPTZ,
  edits             SMALLINT NOT NULL DEFAULT 0,
  end_reason        TEXT CHECK (end_reason IN
                    ('empty', 'recalled', 'lapsed', 'suspended', 'reported', 'removed', 'note_held')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  email_notified_at TIMESTAMPTZ,
  email_attempts    SMALLINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX voyages_one_open ON public.voyages (kayak_id) WHERE state <> 'home';
CREATE INDEX voyages_due_idx ON public.voyages (state, sail_until) WHERE state IN ('sailing', 'returning');
CREATE INDEX voyages_owner_idx ON public.voyages (owner_id);

-- The live note: screen = 'ok' and not superseded. An edit is a new row, and
-- takes over (with a fresh guestbook) only once it passes.
CREATE TABLE public.kayak_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id       UUID NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  screen          TEXT CHECK (screen IN ('ok', 'held')),
  screen_reason   TEXT CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam', 'minor', 'review', 'crisis')),
  screen_attempts SMALLINT NOT NULL DEFAULT 0,
  reported_at     TIMESTAMPTZ,
  superseded_at   TIMESTAMPTZ,
  acked_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX kayak_notes_voyage_idx ON public.kayak_notes (voyage_id);
CREATE INDEX kayak_notes_unscreened_idx ON public.kayak_notes (created_at) WHERE screen IS NULL;
CREATE INDEX kayak_notes_owner_held_idx ON public.kayak_notes (owner_id) WHERE screen = 'held' AND acked_at IS NULL;

CREATE TABLE public.kayak_visits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id         UUID NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  owner_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  city              TEXT,
  arrived_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at           TIMESTAMPTZ,
  left_reason       TEXT,
  email_notified_at TIMESTAMPTZ,
  email_attempts    SMALLINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX kayak_visits_one_open ON public.kayak_visits (voyage_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX kayak_visits_one_per_owner ON public.kayak_visits (recipient_id, owner_id) WHERE left_at IS NULL;
CREATE INDEX kayak_visits_voyage_idx ON public.kayak_visits (voyage_id, recipient_id);

-- Comments outlive the voyage: the commenter's treasure card still shows theirs.
CREATE TABLE public.kayak_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id         UUID REFERENCES public.kayak_notes(id) ON DELETE SET NULL,
  visit_id        UUID UNIQUE REFERENCES public.kayak_visits(id) ON DELETE SET NULL,
  author_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 10 AND 280),
  screen          TEXT CHECK (screen IN ('ok', 'held')),
  screen_reason   TEXT CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam', 'minor', 'review', 'crisis')),
  screen_attempts SMALLINT NOT NULL DEFAULT 0,
  reported_at     TIMESTAMPTZ,
  acked_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX kayak_comments_note_idx ON public.kayak_comments (note_id);
CREATE INDEX kayak_comments_unscreened_idx ON public.kayak_comments (created_at) WHERE screen IS NULL;
CREATE INDEX kayak_comments_author_idx ON public.kayak_comments (author_id);

-- A gem is its seed: apps/web/lib/gems decodes the seed's mixed-radix digits
-- into traits, one to one, so UNIQUE (engine, seed) means no two gems match.
--   stock     the owner's, in no Kayak
--   aboard    in kayak_id
--   reserved  picked, waiting on the comment's screen
--   kept      in holder_id's treasure room
CREATE TABLE public.gems (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine     SMALLINT NOT NULL DEFAULT 1,
  seed       BIGINT NOT NULL CHECK (seed >= 0),
  owner_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  kayak_id   UUID REFERENCES public.kayaks(id) ON DELETE SET NULL,
  state      TEXT NOT NULL CHECK (state IN ('stock', 'aboard', 'reserved', 'kept')),
  holder_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.kayak_comments(id) ON DELETE SET NULL,
  kept_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engine, seed)
);
CREATE INDEX gems_kayak_idx ON public.gems (kayak_id) WHERE state = 'aboard';
CREATE INDEX gems_owner_stock_idx ON public.gems (owner_id) WHERE state = 'stock';
CREATE INDEX gems_holder_idx ON public.gems (holder_id);
CREATE INDEX gems_comment_idx ON public.gems (comment_id);

-- Ungenerated gems left this month. Topped up lazily by kayak_topup().
CREATE TABLE public.kayak_allowances (
  user_id        UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  remaining      SMALLINT NOT NULL CHECK (remaining >= 0),
  cap            SMALLINT NOT NULL,
  next_refill_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.kayaks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voyages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kayak_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kayak_visits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kayak_comments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gems             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kayak_allowances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kayaks, public.voyages, public.kayak_notes, public.kayak_visits,
  public.kayak_comments, public.gems, public.kayak_allowances FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kayaks, public.voyages, public.kayak_notes,
  public.kayak_visits, public.kayak_comments, public.gems, public.kayak_allowances TO service_role;

-- 'City near you' for arriving Kayaks. Written by the profile route from
-- Vercel's IP header; profiles UPDATE is column-restricted (038), so a client
-- can't set these itself.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city            TEXT CHECK (char_length(city) <= 80),
  ADD COLUMN IF NOT EXISTS city_updated_at TIMESTAMPTZ;

-- ─── moderation of notes and comments ───────────────────────────────────────
CREATE TRIGGER kayak_notes_guard BEFORE INSERT ON public.kayak_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_content('body');
CREATE TRIGGER kayak_comments_guard BEFORE INSERT ON public.kayak_comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_content('body');
-- screen_new_social posts {table, id} to screen-bottle, which uses the bottle checks.
CREATE TRIGGER kayak_notes_screen AFTER INSERT ON public.kayak_notes
  FOR EACH ROW EXECUTE FUNCTION public.screen_new_social();
CREATE TRIGGER kayak_comments_screen AFTER INSERT ON public.kayak_comments
  FOR EACH ROW EXECUTE FUNCTION public.screen_new_social();

DELETE FROM public.moderation_queue WHERE kind = 'profile';
ALTER TABLE public.moderation_queue DROP CONSTRAINT IF EXISTS moderation_queue_kind_check;
ALTER TABLE public.moderation_queue ADD CONSTRAINT moderation_queue_kind_check
  CHECK (kind IN ('bottle', 'kayak_note', 'kayak_comment', 'user'));

CREATE OR REPLACE FUNCTION public.moderation_author(p_kind TEXT, p_target UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'bottle'        THEN (SELECT sender_id FROM public.bottles WHERE id = p_target)
    WHEN 'kayak_note'    THEN (SELECT owner_id FROM public.kayak_notes WHERE id = p_target)
    WHEN 'kayak_comment' THEN (SELECT author_id FROM public.kayak_comments WHERE id = p_target)
    WHEN 'user'          THEN p_target
  END;
$$;

-- 055 body, with notes and comments counted exactly as bottles are.
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
    + (SELECT count(*) FROM public.kayak_notes
       WHERE owner_id = p_uid AND created_at > now() - interval '30 days'
         AND ((screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
              OR reported_at IS NOT NULL))
    + (SELECT count(*) FROM public.kayak_comments
       WHERE author_id = p_uid AND created_at > now() - interval '30 days'
         AND ((screen = 'held' AND screen_reason IN ('sexual', 'harm', 'minor'))
              OR reported_at IS NOT NULL))
  INTO v_n;
  IF v_n >= 3 THEN
    PERFORM public.suspend_user(p_uid, 'repeated ' || p_reason);
  END IF;
END;
$$;

-- ─── internal helpers ───────────────────────────────────────────────────────
-- Open tabs refetch on this; the payload is empty, like every other user event.
CREATE OR REPLACE FUNCTION public.kayak_ping(p_uid UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT realtime.send('{}'::jsonb, 'kayak_update', 'user:' || p_uid::text, true);
$$;

-- Kayaks at sea keep sailing for 3 days past access_until, covering card
-- retries. Everything that creates (load, launch, edit, comment) uses is_keeper.
CREATE OR REPLACE FUNCTION public.owner_may_sail(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m JOIN public.profiles p ON p.id = m.user_id
    WHERE m.user_id = p_uid AND m.access_until > now() - interval '3 days'
      AND p.suspended_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.kayak_require_member()
RETURNS UUID
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
  IF NOT public.is_keeper(uid) THEN
    RAISE EXCEPTION 'keeper_only' USING ERRCODE = '42501';
  END IF;
  RETURN uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.kayak_current_note(p_voyage UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.kayak_notes
  WHERE voyage_id = p_voyage AND screen = 'ok' AND superseded_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
$$;

-- Top up to the cap on each monthly anniversary of keeper_since; no rollover.
-- Trial: 5. Accounts get one 7-day trial (lib/dodo.ts TRIAL_DAYS), so a member
-- still live past that has paid, and the cap rises the moment that's true.
-- Returns what's left; a lapsed member's row is left alone.
CREATE OR REPLACE FUNCTION public.kayak_topup(p_uid UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_m    public.memberships%ROWTYPE;
  v_a    public.kayak_allowances%ROWTYPE;
  v_cap  SMALLINT;
  v_age  INTERVAL;
  v_next TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_a FROM public.kayak_allowances WHERE user_id = p_uid FOR UPDATE;
  SELECT * INTO v_m FROM public.memberships WHERE user_id = p_uid;
  IF NOT FOUND OR v_m.access_until <= now() THEN
    RETURN COALESCE(v_a.remaining, 0);
  END IF;

  v_cap := CASE WHEN v_m.plan = 'lifetime' OR now() >= v_m.keeper_since + interval '7 days'
                THEN 30 ELSE 5 END;
  v_age := age(now(), v_m.keeper_since);
  -- Always from keeper_since, so a month end doesn't drift (Jan 31 → Feb 28 → Mar 31).
  v_next := v_m.keeper_since
    + make_interval(months => (extract(year FROM v_age) * 12 + extract(month FROM v_age))::int + 1);

  INSERT INTO public.kayak_allowances AS a (user_id, remaining, cap, next_refill_at)
  VALUES (p_uid, v_cap, v_cap, v_next)
  ON CONFLICT (user_id) DO UPDATE SET
    remaining = CASE WHEN now() >= a.next_refill_at OR EXCLUDED.cap > a.cap
                     THEN EXCLUDED.cap ELSE a.remaining END,
    cap = EXCLUDED.cap,
    next_refill_at = EXCLUDED.next_refill_at
  RETURNING remaining INTO v_cap;
  RETURN v_cap;
END;
$$;

-- Every way home except a Kayak that never left. Unpicked gems go to stock.
CREATE OR REPLACE FUNCTION public.kayak_send_home(p_voyage UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.voyages%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.voyages WHERE id = p_voyage FOR UPDATE;
  IF NOT FOUND OR v.state IN ('returning', 'home') THEN
    RETURN;
  END IF;
  UPDATE public.kayak_visits SET left_at = now(), left_reason = p_reason
  WHERE voyage_id = p_voyage AND left_at IS NULL;
  UPDATE public.gems SET state = 'stock', kayak_id = NULL
  WHERE kayak_id = v.kayak_id AND state = 'aboard';
  UPDATE public.voyages
  SET state = 'returning', sail_until = now() + interval '1 hour', end_reason = p_reason
  WHERE id = p_voyage;
  PERFORM public.kayak_ping(v.owner_id);
END;
$$;

-- Still at the mast (the note never passed, or it was called back in time).
-- Gems stay aboard, ready for the rewrite.
CREATE OR REPLACE FUNCTION public.kayak_stay_ashore(p_voyage UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.voyages
  SET state = 'home', sail_until = NULL, ended_at = now(), end_reason = p_reason,
      email_notified_at = now() -- it never sailed, so there's no homecoming to announce
  WHERE id = p_voyage AND state = 'screening';
$$;

-- The next leg after a visit: on to another harbour, or home if nothing's left.
CREATE OR REPLACE FUNCTION public.kayak_next_leg(p_voyage UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.voyages%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.voyages WHERE id = p_voyage FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.gems WHERE kayak_id = v.kayak_id AND state = 'aboard') THEN
    UPDATE public.voyages SET state = 'sailing', sail_until = now() + interval '1 hour'
    WHERE id = p_voyage;
    PERFORM public.kayak_ping(v.owner_id);
  ELSE
    PERFORM public.kayak_send_home(p_voyage, 'empty');
  END IF;
END;
$$;

-- Comment held or removed: the gem goes back to the Kayak if it's still at sea,
-- otherwise to its owner's stock.
CREATE OR REPLACE FUNCTION public.kayak_release_gem(p_comment UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kayak UUID;
BEGIN
  SELECT vy.kayak_id INTO v_kayak
  FROM public.kayak_comments c
  JOIN public.kayak_visits vi ON vi.id = c.visit_id
  JOIN public.voyages vy ON vy.id = vi.voyage_id
  WHERE c.id = p_comment AND vy.state IN ('sailing', 'visiting');

  DELETE FROM public.gems WHERE comment_id = p_comment AND state = 'reserved' AND owner_id IS NULL;
  UPDATE public.gems
  SET state = CASE WHEN v_kayak IS NULL THEN 'stock' ELSE 'aboard' END,
      kayak_id = v_kayak, holder_id = NULL, comment_id = NULL
  WHERE comment_id = p_comment AND state = 'reserved';
END;
$$;

CREATE OR REPLACE FUNCTION public.kayak_keep_gem(p_comment UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.gems SET state = 'kept', kayak_id = NULL, kept_at = now()
  WHERE comment_id = p_comment AND state = 'reserved';
$$;

CREATE OR REPLACE FUNCTION public.kayak_promote_note(p_note UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.kayak_notes o SET superseded_at = now()
  FROM public.kayak_notes n
  WHERE n.id = p_note AND o.voyage_id = n.voyage_id AND o.id <> n.id AND o.superseded_at IS NULL;
$$;

-- ─── the screen's verdict ───────────────────────────────────────────────────
-- 052's rules: crisis is held with helplines, no strike and no queue item;
-- minor and review are queued; sexual, harm and minor strike.
CREATE OR REPLACE FUNCTION public.apply_kayak_screen(
  p_table   TEXT,
  p_id      UUID,
  p_verdict TEXT,
  p_reason  TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_author UUID;
  v_voyage public.voyages%ROWTYPE;
  v_note   UUID;
  v_kind   TEXT;
BEGIN
  IF p_verdict = 'crisis' THEN
    p_verdict := 'held';
    p_reason  := 'crisis';
  END IF;
  IF p_verdict NOT IN ('ok', 'held') THEN
    RAISE EXCEPTION 'bad verdict %', p_verdict;
  END IF;

  IF p_table = 'kayak_notes' THEN
    v_kind := 'kayak_note';
    SELECT n.owner_id, n.voyage_id INTO v_author, v_note FROM public.kayak_notes n WHERE n.id = p_id;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
    SELECT * INTO v_voyage FROM public.voyages WHERE id = v_note FOR UPDATE;
    UPDATE public.kayak_notes
    SET screen = p_verdict,
        screen_reason = CASE WHEN p_verdict = 'held' THEN p_reason END,
        superseded_at = CASE WHEN p_verdict = 'held' THEN now() ELSE superseded_at END
    WHERE id = p_id AND screen IS NULL;
    IF NOT FOUND THEN
      RETURN 'already_screened'; -- pg_net may deliver twice
    END IF;

    IF p_verdict = 'ok' THEN
      IF v_voyage.state = 'screening' THEN
        -- The first leg counts from launch, like a bottle from its throw.
        UPDATE public.voyages
        SET state = 'sailing', sail_until = GREATEST(now(), started_at + interval '1 hour')
        WHERE id = v_voyage.id;
      ELSIF v_voyage.state IN ('sailing', 'visiting') THEN
        PERFORM public.kayak_promote_note(p_id);
      ELSE
        -- Called home while the edit was being checked; it never goes live.
        UPDATE public.kayak_notes SET superseded_at = now() WHERE id = p_id;
      END IF;
    ELSIF v_voyage.state = 'screening' THEN
      PERFORM public.kayak_stay_ashore(v_voyage.id, 'note_held');
    END IF;

  ELSIF p_table = 'kayak_comments' THEN
    v_kind := 'kayak_comment';
    SELECT c.author_id INTO v_author FROM public.kayak_comments c WHERE c.id = p_id;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
    UPDATE public.kayak_comments
    SET screen = p_verdict, screen_reason = CASE WHEN p_verdict = 'held' THEN p_reason END
    WHERE id = p_id AND screen IS NULL;
    IF NOT FOUND THEN
      RETURN 'already_screened';
    END IF;
    IF p_verdict = 'ok' THEN
      PERFORM public.kayak_keep_gem(p_id);
    ELSIF p_reason NOT IN ('minor', 'review') THEN
      -- Queued holds keep the gem reserved until an admin rules.
      PERFORM public.kayak_release_gem(p_id);
    END IF;

  ELSE
    RAISE EXCEPTION 'bad table %', p_table;
  END IF;

  IF v_author IS NOT NULL THEN
    PERFORM public.kayak_ping(v_author);
  END IF;
  IF p_verdict = 'held' THEN
    IF p_reason IN ('minor', 'review') THEN
      PERFORM public.enqueue_moderation(v_kind, p_id, 'screen', p_reason);
    END IF;
    IF p_reason IN ('sexual', 'harm', 'minor') THEN
      PERFORM public.record_strike(v_author, p_reason);
    END IF;
  END IF;
  RETURN p_verdict;
END;
$$;

-- 056 body for bottles; profiles gave way to notes and comments.
CREATE OR REPLACE FUNCTION public.rescreen_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url  TEXT;
  v_key  TEXT;
  v_n    INTEGER := 0;
  r      RECORD;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('rescreen_pending')) THEN
    RETURN 0;
  END IF;
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key FROM public._notify_config() c;

  FOR r IN
    SELECT id, screen_attempts FROM public.bottles
    WHERE screen IS NULL AND received_at IS NULL AND is_stale = FALSE
      AND sent_at < now() - interval '2 minutes'
    ORDER BY sent_at
    LIMIT 100
  LOOP
    IF r.screen_attempts >= 6 THEN
      PERFORM public.apply_screen(r.id, 'held', 'review');
    ELSE
      UPDATE public.bottles SET screen_attempts = screen_attempts + 1 WHERE id = r.id;
      IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
        PERFORM net.http_post(
          url     := v_url || '/functions/v1/screen-bottle',
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'Authorization', 'Bearer ' || v_key),
          body    := jsonb_build_object('bottle_id', r.id));
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- Notes and comments: exhausted → held for review; the rest → one more try.
  FOR r IN
    SELECT 'kayak_notes' AS tbl, id, screen_attempts, created_at FROM public.kayak_notes
    WHERE screen IS NULL AND created_at < now() - interval '2 minutes'
    UNION ALL
    SELECT 'kayak_comments', id, screen_attempts, created_at FROM public.kayak_comments
    WHERE screen IS NULL AND created_at < now() - interval '2 minutes'
    ORDER BY created_at
    LIMIT 100
  LOOP
    IF r.screen_attempts >= 6 THEN
      PERFORM public.apply_kayak_screen(r.tbl, r.id, 'held', 'review');
    ELSE
      IF r.tbl = 'kayak_notes' THEN
        UPDATE public.kayak_notes SET screen_attempts = screen_attempts + 1 WHERE id = r.id;
      ELSE
        UPDATE public.kayak_comments SET screen_attempts = screen_attempts + 1 WHERE id = r.id;
      END IF;
      IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
        PERFORM net.http_post(
          url     := v_url || '/functions/v1/screen-bottle',
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'Authorization', 'Bearer ' || v_key),
          body    := jsonb_build_object('table', r.tbl, 'id', r.id));
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

-- ─── admin ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_queue()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not an admin' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',         q.id,
      'kind',       q.kind,
      'source',     q.source,
      'reason',     q.reason,
      'reports',    q.reports,
      'created_at', q.created_at,
      'text', CASE q.kind
        WHEN 'bottle'        THEN (SELECT message FROM public.bottles WHERE id = q.target_id)
        WHEN 'kayak_note'    THEN (SELECT body FROM public.kayak_notes WHERE id = q.target_id)
        WHEN 'kayak_comment' THEN (SELECT body FROM public.kayak_comments WHERE id = q.target_id)
        WHEN 'user'          THEN (SELECT 'Suspended: ' || COALESCE(suspension_reason, '?')
                                   FROM public.profiles WHERE id = q.target_id)
      END,
      'state', CASE q.kind
        WHEN 'bottle'        THEN (SELECT COALESCE(screen, 'unscreened') FROM public.bottles WHERE id = q.target_id)
        WHEN 'kayak_note'    THEN (SELECT COALESCE(screen, 'unscreened') FROM public.kayak_notes WHERE id = q.target_id)
        WHEN 'kayak_comment' THEN (SELECT COALESCE(screen, 'unscreened') FROM public.kayak_comments WHERE id = q.target_id)
        WHEN 'user'          THEN (SELECT CASE WHEN suspended_at IS NULL THEN 'active' ELSE 'suspended' END
                                   FROM public.profiles WHERE id = q.target_id)
      END
    ) ORDER BY q.created_at)
    FROM public.moderation_queue q
    WHERE q.resolved_at IS NULL
  ), '[]'::jsonb);
END;
$$;

-- 055 body, with notes and comments in place of profiles.
CREATE OR REPLACE FUNCTION public.admin_moderate(p_item UUID, p_action TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  q        public.moderation_queue%ROWTYPE;
  v_result TEXT;
  v_voyage UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not an admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO q FROM public.moderation_queue WHERE id = p_item AND resolved_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF p_action IN ('remove', 'suspend') THEN
    CASE q.kind
      -- is_reported pulls a delivered bottle from the receiver's inbox,
      -- logbook, ripple and keep (all filter on it).
      WHEN 'bottle' THEN UPDATE public.bottles
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'),
            is_stale = TRUE, is_reported = TRUE WHERE id = q.target_id;
      WHEN 'kayak_note' THEN
        UPDATE public.kayak_notes
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review'),
            superseded_at = COALESCE(superseded_at, now())
        WHERE id = q.target_id
        RETURNING voyage_id INTO v_voyage;
        -- Live when removed: the Kayak can't carry on without its note.
        IF v_voyage IS NOT NULL AND public.kayak_current_note(v_voyage) IS NULL THEN
          PERFORM public.kayak_send_home(v_voyage, 'removed');
        END IF;
      WHEN 'kayak_comment' THEN
        UPDATE public.kayak_comments
        SET screen = 'held', screen_reason = COALESCE(screen_reason, 'review')
        WHERE id = q.target_id;
        PERFORM public.kayak_release_gem(q.target_id);
      ELSE RAISE EXCEPTION 'cannot remove a %', q.kind USING ERRCODE = '22023';
    END CASE;
    v_result := 'removed';
    IF p_action = 'suspend' THEN
      PERFORM public.suspend_user(public.moderation_author(q.kind, q.target_id), 'moderator', FALSE);
      v_result := 'suspended';
    END IF;

  ELSIF p_action = 'restore' THEN
    CASE q.kind
      WHEN 'bottle' THEN
        BEGIN
          UPDATE public.bottles
          SET screen = 'ok', screen_reason = NULL,
              is_stale = CASE WHEN received_at IS NULL THEN FALSE ELSE is_stale END
          WHERE id = q.target_id;
        EXCEPTION WHEN unique_violation THEN
          -- The sender already threw a rewrite that day; keep this one ashore.
          RETURN 'rewrite_exists';
        END;
      -- A restored note is cleared, not relaunched, unless it's an edit on a
      -- Kayak still at sea, which then takes over as a passed edit would.
      WHEN 'kayak_note' THEN
        UPDATE public.kayak_notes n
        SET screen = 'ok', screen_reason = NULL, reported_at = NULL,
            superseded_at = CASE WHEN v.state IN ('sailing', 'visiting') THEN NULL
                                 ELSE COALESCE(n.superseded_at, now()) END
        FROM public.voyages v
        WHERE n.id = q.target_id AND v.id = n.voyage_id
        RETURNING CASE WHEN v.state IN ('sailing', 'visiting') THEN n.id END INTO v_voyage;
        IF v_voyage IS NOT NULL THEN
          PERFORM public.kayak_promote_note(v_voyage);
        END IF;
      WHEN 'kayak_comment' THEN
        UPDATE public.kayak_comments
        SET screen = 'ok', screen_reason = NULL, reported_at = NULL
        WHERE id = q.target_id;
        PERFORM public.kayak_keep_gem(q.target_id);
      WHEN 'user' THEN UPDATE public.profiles SET suspended_at = NULL, suspension_reason = NULL WHERE id = q.target_id;
    END CASE;
    v_result := 'restored';

  ELSIF p_action = 'dismiss' THEN
    -- Nothing to restore, but a held comment's gem can't wait forever.
    IF q.kind = 'kayak_comment' THEN
      PERFORM public.kayak_release_gem(q.target_id);
    END IF;
    v_result := 'dismissed';

  ELSE
    RAISE EXCEPTION 'unknown action %', p_action USING ERRCODE = '22023';
  END IF;

  UPDATE public.moderation_queue SET resolved_at = now(), resolution = v_result WHERE id = q.id;
  RETURN v_result;
END;
$$;

-- ─── the sailing engine ─────────────────────────────────────────────────────
-- Random among live paid members, fewest visits this voyage first, so nobody
-- repeats until everyone's had a turn. Activity deliberately doesn't count
-- (user decision): emails can bring people back.
-- Not within 24h of leaving that harbour, or a member who's the only other
-- Keeper would get the same Kayak, and its email, every hour.
CREATE OR REPLACE FUNCTION public.kayak_pick_recipient(p_voyage UUID, p_owner UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.user_id
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.access_until > now()
    AND m.user_id <> p_owner
    AND p.suspended_at IS NULL
    AND p.age_confirmed_at IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.kayak_blocks b
      WHERE (b.blocker_id = m.user_id AND b.blocked_id = p_owner)
         OR (b.blocker_id = p_owner AND b.blocked_id = m.user_id))
    AND NOT EXISTS (SELECT 1 FROM public.kayak_reports r
      WHERE r.reporter_id = m.user_id AND r.target_id = p_owner)
    AND NOT EXISTS (SELECT 1 FROM public.kayak_visits v
      WHERE v.recipient_id = m.user_id AND v.owner_id = p_owner AND v.left_at IS NULL)
    AND (SELECT count(*) FROM public.kayak_visits v
         WHERE v.recipient_id = m.user_id AND v.left_at IS NULL) < 3
    AND NOT EXISTS (SELECT 1 FROM public.kayak_visits v
      WHERE v.voyage_id = p_voyage AND v.recipient_id = m.user_id
        AND v.left_at > now() - interval '24 hours')
  ORDER BY (SELECT count(*) FROM public.kayak_visits v
            WHERE v.voyage_id = p_voyage AND v.recipient_id = m.user_id),
           random()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.kayak_post_email(p_body JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key FROM public._notify_config() c;
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/notify-kayak',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := p_body);
  END IF;
END;
$$;

-- Runs every 15 minutes. Single-flight, so a move here can't double up; RPCs
-- that move a Kayak take the voyage row lock first.
CREATE OR REPLACE FUNCTION public.advance_kayaks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r      RECORD;
  v_who  UUID;
  v_city TEXT;
  v_id   UUID;
  v_n    INTEGER := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('advance_kayaks')) THEN
    RETURN 0;
  END IF;

  -- 1. Owners who lost the right to sail. The 3-day grace is in owner_may_sail.
  FOR r IN
    SELECT v.id, v.state, p.suspended_at IS NOT NULL AS suspended
    FROM public.voyages v JOIN public.profiles p ON p.id = v.owner_id
    WHERE v.state IN ('screening', 'sailing', 'visiting')
      AND NOT public.owner_may_sail(v.owner_id)
  LOOP
    IF r.state = 'screening' THEN
      PERFORM public.kayak_stay_ashore(r.id, CASE WHEN r.suspended THEN 'suspended' ELSE 'lapsed' END);
    ELSE
      PERFORM public.kayak_send_home(r.id, CASE WHEN r.suspended THEN 'suspended' ELSE 'lapsed' END);
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- 2. Visits that are over: 24h up, or the recipient can no longer have it.
  -- Recipients get no grace, and a block made since arrival counts.
  FOR r IN
    SELECT vi.id, vi.voyage_id,
           CASE WHEN vi.arrived_at <= now() - interval '24 hours' THEN 'expired' ELSE 'ineligible' END AS why
    FROM public.kayak_visits vi
    JOIN public.profiles p ON p.id = vi.recipient_id
    WHERE vi.left_at IS NULL
      AND (vi.arrived_at <= now() - interval '24 hours'
           OR NOT public.is_keeper(vi.recipient_id)
           OR p.suspended_at IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.kayak_blocks b
             WHERE (b.blocker_id = vi.recipient_id AND b.blocked_id = vi.owner_id)
                OR (b.blocker_id = vi.owner_id AND b.blocked_id = vi.recipient_id)))
  LOOP
    UPDATE public.kayak_visits SET left_at = now(), left_reason = r.why WHERE id = r.id;
    PERFORM public.kayak_next_leg(r.voyage_id);
    v_n := v_n + 1;
  END LOOP;

  -- A recipient who deleted their account took the visit row with them.
  FOR r IN
    SELECT v.id FROM public.voyages v
    WHERE v.state = 'visiting'
      AND NOT EXISTS (SELECT 1 FROM public.kayak_visits vi WHERE vi.voyage_id = v.id AND vi.left_at IS NULL)
  LOOP
    PERFORM public.kayak_next_leg(r.id);
    v_n := v_n + 1;
  END LOOP;

  -- 3. Home at the mast.
  FOR r IN
    SELECT id, owner_id FROM public.voyages WHERE state = 'returning' AND sail_until <= now()
  LOOP
    UPDATE public.voyages SET state = 'home', sail_until = NULL, ended_at = now() WHERE id = r.id;
    PERFORM public.kayak_ping(r.owner_id);
    PERFORM public.kayak_post_email(jsonb_build_object('voyage_id', r.id));
    v_n := v_n + 1;
  END LOOP;

  -- 4. Arrivals. No fitting harbour: it keeps sailing and tries next run.
  FOR r IN
    SELECT id, owner_id FROM public.voyages
    WHERE state = 'sailing' AND sail_until <= now()
    ORDER BY sail_until
  LOOP
    BEGIN
      IF public.kayak_current_note(r.id) IS NULL THEN
        CONTINUE;
      END IF;
      v_who := public.kayak_pick_recipient(r.id, r.owner_id);
      IF v_who IS NULL THEN
        CONTINUE;
      END IF;
      SELECT city INTO v_city FROM public.profiles WHERE id = v_who;
      INSERT INTO public.kayak_visits (voyage_id, owner_id, recipient_id, city)
      VALUES (r.id, r.owner_id, v_who, v_city)
      RETURNING id INTO v_id;
      UPDATE public.voyages SET state = 'visiting', sail_until = NULL WHERE id = r.id;
      PERFORM public.kayak_ping(v_who);
      PERFORM public.kayak_ping(r.owner_id);
      PERFORM public.kayak_post_email(jsonb_build_object('visit_id', v_id));
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'advance_kayaks: arrival for voyage % failed: %', r.id, SQLERRM;
    END;
  END LOOP;

  -- 5. Emails that never landed. Same limits as bottles (038): 20 a run, 8 tries.
  FOR r IN
    SELECT vi.id FROM public.kayak_visits vi
    JOIN public.profiles p ON p.id = vi.recipient_id
    WHERE vi.left_at IS NULL AND vi.email_notified_at IS NULL AND vi.email_attempts < 8
      AND p.email_notifications = TRUE AND vi.arrived_at < now() - interval '10 minutes'
    ORDER BY vi.email_attempts, vi.arrived_at
    LIMIT 20
  LOOP
    UPDATE public.kayak_visits SET email_attempts = email_attempts + 1 WHERE id = r.id;
    PERFORM public.kayak_post_email(jsonb_build_object('visit_id', r.id));
  END LOOP;
  FOR r IN
    SELECT v.id FROM public.voyages v
    JOIN public.profiles p ON p.id = v.owner_id
    WHERE v.state = 'home' AND v.email_notified_at IS NULL AND v.email_attempts < 8
      AND p.email_notifications = TRUE AND v.ended_at < now() - interval '10 minutes'
    ORDER BY v.email_attempts, v.ended_at
    LIMIT 20
  LOOP
    UPDATE public.voyages SET email_attempts = email_attempts + 1 WHERE id = r.id;
    PERFORM public.kayak_post_email(jsonb_build_object('voyage_id', r.id));
  END LOOP;

  RETURN v_n;
END;
$$;

SELECT cron.schedule('advance-kayaks', '*/15 * * * *', $$ SELECT public.advance_kayaks(); $$);

-- ─── customization ──────────────────────────────────────────────────────────
-- ponytail: these lists mirror apps/web/lib/kayakLook.ts; a test keeps them
-- equal. Colours come from the Atelier's pastel catalogue (061).
CREATE OR REPLACE FUNCTION public.check_kayak_look(p_look JSONB)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot TEXT;
  v_item TEXT;
BEGIN
  IF jsonb_typeof(p_look) <> 'object'
     OR (p_look ->> 'vessel') IS NULL
     OR (p_look ->> 'vessel') NOT IN ('sit_on_top', 'sea_kayak', 'canoe', 'rowing_boat', 'dinghy',
                                      'sailboat', 'punt', 'coracle', 'pirogue', 'outrigger')
     OR COALESCE(p_look ->> 'pattern', 'none') NOT IN ('none', 'stripes', 'waves', 'scales', 'stars', 'woodgrain', 'faded')
     OR (p_look ->> 'paddle') IS NULL
     OR (p_look ->> 'paddle') NOT IN ('double_blade', 'canoe_paddle', 'wooden_oars', 'painted_tips')
     OR NOT EXISTS (SELECT 1 FROM public.atelier_pieces a
                    WHERE a.kind = 'glass' AND a.id = p_look ->> 'color' AND NOT a.retired) THEN
    RAISE EXCEPTION 'bad_look' USING ERRCODE = '22023';
  END IF;
  IF p_look ? 'deck' THEN
    IF jsonb_typeof(p_look -> 'deck') <> 'object' THEN
      RAISE EXCEPTION 'bad_look' USING ERRCODE = '22023';
    END IF;
    FOR v_slot, v_item IN SELECT key, value FROM jsonb_each_text(p_look -> 'deck') LOOP
      IF v_slot NOT IN ('bow', 'mid', 'stern')
         OR (v_item IS NOT NULL AND v_item NOT IN ('lantern', 'flag', 'plant', 'cat', 'dog', 'books', 'gull', 'fishing_rod',
                                               'crate', 'rope', 'teapot', 'parasol', 'guitar', 'blanket', 'shells', 'radio')) THEN
        RAISE EXCEPTION 'bad_look' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- ─── owner RPCs ─────────────────────────────────────────────────────────────
-- Build (p_id NULL) or change a look. At the mast only: a look locks at launch.
CREATE OR REPLACE FUNCTION public.save_kayak_look(p_id UUID, p_look JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid  UUID := public.kayak_require_member();
  v_id UUID;
BEGIN
  PERFORM public.check_kayak_look(p_look);
  -- Serializes this member's builds, so the limit of 3 can't be raced.
  PERFORM 1 FROM public.profiles WHERE id = uid FOR UPDATE;
  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM public.kayaks WHERE owner_id = uid) >= 3 THEN
      RAISE EXCEPTION 'kayak_limit' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.kayaks (owner_id, look) VALUES (uid, p_look) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.voyages WHERE kayak_id = p_id AND state <> 'home') THEN
    RAISE EXCEPTION 'at_sea' USING ERRCODE = '23514';
  END IF;
  UPDATE public.kayaks SET look = p_look WHERE id = p_id AND owner_id = uid RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_id;
END;
$$;

-- At the mast only. Its gems go to stock; its voyage log goes with it.
CREATE OR REPLACE FUNCTION public.delete_kayak(p_id UUID)
RETURNS BOOLEAN
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
  IF EXISTS (SELECT 1 FROM public.voyages WHERE kayak_id = p_id AND state <> 'home') THEN
    RAISE EXCEPTION 'at_sea' USING ERRCODE = '23514';
  END IF;
  UPDATE public.gems g SET state = 'stock', kayak_id = NULL
  FROM public.kayaks k
  WHERE k.id = p_id AND k.owner_id = uid AND g.kayak_id = k.id AND g.state = 'aboard';
  DELETE FROM public.kayaks WHERE id = p_id AND owner_id = uid;
  RETURN FOUND;
END;
$$;

-- "Get gemstones". Returned gems first, then new ones from the allowance.
-- New gems take the families this Kayak has least of, so a fresh load of 30
-- shows all 30. Seed digits, low to high: family 30, palette 36, silhouette 48,
-- facets 24, texture 24, finish 8. See apps/web/lib/gems/engine.ts.
CREATE OR REPLACE FUNCTION public.load_gems(p_kayak UUID, p_count INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     UUID := public.kayak_require_member();
  v_held  INT;
  v_left  INT;
  v_new   INT;
  v_fam   INT;
  v_seed  BIGINT;
  v_done  BOOLEAN;
BEGIN
  PERFORM 1 FROM public.kayaks WHERE id = p_kayak AND owner_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.voyages WHERE kayak_id = p_kayak AND state <> 'home') THEN
    RAISE EXCEPTION 'at_sea' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_held FROM public.gems WHERE kayak_id = p_kayak AND state = 'aboard';
  IF p_count IS NULL OR p_count < 1 OR v_held + p_count > 30 THEN
    RAISE EXCEPTION 'bad_count' USING ERRCODE = '22023';
  END IF;

  v_left := public.kayak_topup(uid);
  -- Exclusive of concurrent loads through the allowance row, and of stock
  -- through the row locks below.
  PERFORM 1 FROM public.kayak_allowances WHERE user_id = uid FOR UPDATE;
  WITH taken AS (
    SELECT id FROM public.gems
    WHERE owner_id = uid AND state = 'stock'
    ORDER BY created_at
    LIMIT p_count
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.gems g SET state = 'aboard', kayak_id = p_kayak
  FROM taken WHERE g.id = taken.id;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  v_new := p_count - v_new;

  IF v_new > v_left THEN
    RAISE EXCEPTION 'not_enough_gems' USING ERRCODE = '23514';
  END IF;

  FOR i IN 1..v_new LOOP
    SELECT f INTO v_fam
    FROM generate_series(0, 29) f
    ORDER BY (SELECT count(*) FROM public.gems g
              WHERE g.kayak_id = p_kayak AND g.state = 'aboard' AND g.engine = 1 AND g.seed % 30 = f),
             random()
    LIMIT 1;
    -- A collision is about 1 in 8M per family, but the constraint is what
    -- guarantees uniqueness, so retry rather than assume.
    v_done := FALSE;
    WHILE NOT v_done LOOP
      v_seed := v_fam + 30 * (floor(random() * 36)::bigint
                + 36 * (floor(random() * 48)::bigint
                + 48 * (floor(random() * 24)::bigint
                + 24 * (floor(random() * 24)::bigint
                + 24 * floor(random() * 8)::bigint))));
      INSERT INTO public.gems (engine, seed, owner_id, kayak_id, state)
      VALUES (1, v_seed, uid, p_kayak, 'aboard')
      ON CONFLICT (engine, seed) DO NOTHING;
      v_done := FOUND;
    END LOOP;
  END LOOP;

  UPDATE public.kayak_allowances SET remaining = remaining - v_new WHERE user_id = uid;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'engine', engine, 'seed', seed) ORDER BY created_at)
    FROM public.gems WHERE kayak_id = p_kayak AND state = 'aboard'
  ), '[]'::jsonb);
END;
$$;

-- Lower the count before launch; the gem waits in stock.
CREATE OR REPLACE FUNCTION public.unload_gem(p_kayak UUID, p_gem UUID)
RETURNS BOOLEAN
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
  IF EXISTS (SELECT 1 FROM public.voyages WHERE kayak_id = p_kayak AND state <> 'home') THEN
    RAISE EXCEPTION 'at_sea' USING ERRCODE = '23514';
  END IF;
  UPDATE public.gems g SET state = 'stock', kayak_id = NULL
  FROM public.kayaks k
  WHERE g.id = p_gem AND g.kayak_id = p_kayak AND g.state = 'aboard'
    AND k.id = p_kayak AND k.owner_id = uid;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.launch_kayak(p_kayak UUID, p_note TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    UUID := public.kayak_require_member();
  v_id   UUID;
  v_note TEXT := btrim(p_note);
BEGIN
  PERFORM 1 FROM public.kayaks WHERE id = p_kayak AND owner_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gems WHERE kayak_id = p_kayak AND state = 'aboard') THEN
    RAISE EXCEPTION 'no_gems' USING ERRCODE = '23514';
  END IF;
  -- Each attempt is a call to the screen. Bottles have one a day; this stops a
  -- rewrite loop without getting in the way of anyone actually writing.
  IF (SELECT count(*) FROM public.kayak_notes
      WHERE owner_id = uid AND created_at > now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'too_many_notes' USING ERRCODE = '23514';
  END IF;
  BEGIN
    INSERT INTO public.voyages (kayak_id, owner_id) VALUES (p_kayak, uid) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'at_sea' USING ERRCODE = '23514';
  END;
  INSERT INTO public.kayak_notes (voyage_id, owner_id, body) VALUES (v_id, uid, v_note);
  PERFORM public.kayak_ping(uid);
  RETURN v_id;
END;
$$;

-- A new note, checked before it replaces the live one. Passing starts a fresh
-- guestbook. Capped because each edit reaches whoever has the Kayak right now.
CREATE OR REPLACE FUNCTION public.edit_note(p_kayak UUID, p_note TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := public.kayak_require_member();
  v   public.voyages%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.voyages
  WHERE kayak_id = p_kayak AND owner_id = uid AND state IN ('sailing', 'visiting')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_at_sea' USING ERRCODE = 'P0002';
  END IF;
  IF v.edits >= 3 THEN
    RAISE EXCEPTION 'edit_limit' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kayak_notes WHERE voyage_id = v.id AND screen IS NULL) THEN
    RAISE EXCEPTION 'edit_pending' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.kayak_notes (voyage_id, owner_id, body) VALUES (v.id, uid, btrim(p_note));
  UPDATE public.voyages SET edits = edits + 1 WHERE id = v.id;
  RETURN TRUE;
END;
$$;

-- Lapsed owners may still call a Kayak home during the grace, so no Keeper check.
CREATE OR REPLACE FUNCTION public.recall_kayak(p_kayak UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v   public.voyages%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.voyages
  WHERE kayak_id = p_kayak AND owner_id = uid AND state <> 'home'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF v.state = 'screening' THEN
    PERFORM public.kayak_stay_ashore(v.id, 'recalled');
  ELSE
    PERFORM public.kayak_send_home(v.id, 'recalled');
  END IF;
  RETURN TRUE;
END;
$$;

-- ─── visitor RPCs ───────────────────────────────────────────────────────────
-- The visit the caller may act on, locked. Raises if there isn't one.
CREATE OR REPLACE FUNCTION public.kayak_my_visit(p_visit UUID, p_uid UUID)
RETURNS public.kayak_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voyage UUID;
  v        public.kayak_visits%ROWTYPE;
BEGIN
  -- Voyage row first: every path that moves a Kayak locks it in this order.
  SELECT voyage_id INTO v_voyage FROM public.kayak_visits WHERE id = p_visit;
  PERFORM 1 FROM public.voyages WHERE id = v_voyage FOR UPDATE;
  SELECT * INTO v FROM public.kayak_visits
  WHERE id = p_visit AND recipient_id = p_uid AND left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit_over' USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_visit(p_visit UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    UUID := public.kayak_require_member();
  v      public.kayak_visits%ROWTYPE;
  v_k    UUID;
  v_note UUID;
BEGIN
  SELECT * INTO v FROM public.kayak_visits
  WHERE id = p_visit AND recipient_id = uid AND left_at IS NULL;
  IF NOT FOUND OR NOT public.owner_may_sail(v.owner_id) THEN
    RAISE EXCEPTION 'visit_over' USING ERRCODE = 'P0002';
  END IF;
  SELECT kayak_id INTO v_k FROM public.voyages WHERE id = v.voyage_id;
  v_note := public.kayak_current_note(v.voyage_id);
  RETURN jsonb_build_object(
    'id',         v.id,
    'arrived_at', v.arrived_at,
    'leaves_at',  v.arrived_at + interval '24 hours',
    'look',       (SELECT look FROM public.kayaks WHERE id = v_k),
    'note',       (SELECT body FROM public.kayak_notes WHERE id = v_note),
    'guestbook',  COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'at', c.created_at) ORDER BY c.created_at)
      FROM public.kayak_comments c
      WHERE c.note_id = v_note AND c.screen = 'ok' AND c.reported_at IS NULL
    ), '[]'::jsonb),
    'gems',       COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'engine', g.engine, 'seed', g.seed) ORDER BY g.created_at)
      FROM public.gems g WHERE g.kayak_id = v_k AND g.state = 'aboard'
    ), '[]'::jsonb));
END;
$$;

-- One gem for one comment. The Kayak moves on at once; the gem is "on its way"
-- until the comment passes its screen.
CREATE OR REPLACE FUNCTION public.leave_comment(p_visit UUID, p_gem UUID, p_body TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid   UUID := public.kayak_require_member();
  v     public.kayak_visits%ROWTYPE := public.kayak_my_visit(p_visit, uid);
  v_k   UUID;
  v_id  UUID;
BEGIN
  SELECT kayak_id INTO v_k FROM public.voyages WHERE id = v.voyage_id;
  PERFORM 1 FROM public.gems WHERE id = p_gem AND kayak_id = v_k AND state = 'aboard' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'gem_gone' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.kayak_comments (note_id, visit_id, author_id, body)
  VALUES (public.kayak_current_note(v.voyage_id), p_visit, uid, btrim(p_body))
  RETURNING id INTO v_id;

  UPDATE public.gems SET state = 'reserved', holder_id = uid, comment_id = v_id WHERE id = p_gem;
  UPDATE public.kayak_visits SET left_at = now(), left_reason = 'commented' WHERE id = p_visit;
  PERFORM public.kayak_next_leg(v.voyage_id);
  PERFORM public.kayak_ping(uid);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.wave_on(p_visit UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v   public.kayak_visits%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  v := public.kayak_my_visit(p_visit, uid);
  UPDATE public.kayak_visits SET left_at = now(), left_reason = 'waved' WHERE id = p_visit;
  PERFORM public.kayak_next_leg(v.voyage_id);
  PERFORM public.kayak_ping(uid);
  RETURN TRUE;
END;
$$;

-- Bottles' rule: queue and strike. The Kayak goes home, and this reporter never
-- gets this owner's Kayaks again. Owner stays unnamed: only the visit id is known.
CREATE OR REPLACE FUNCTION public.report_note(p_visit UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    UUID := auth.uid();
  v      public.kayak_visits%ROWTYPE;
  v_note UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_reason NOT IN ('sexual', 'harassment', 'spam', 'contact', 'other') THEN
    RAISE EXCEPTION 'unknown report reason' USING ERRCODE = '23514';
  END IF;
  v := public.kayak_my_visit(p_visit, uid);
  v_note := public.kayak_current_note(v.voyage_id);

  INSERT INTO public.kayak_reports (reporter_id, target_id, reason)
  VALUES (uid, v.owner_id, p_reason)
  ON CONFLICT DO NOTHING;
  UPDATE public.kayak_notes SET reported_at = now() WHERE id = v_note;
  PERFORM public.enqueue_moderation('kayak_note', v_note, 'report', p_reason, TRUE);
  PERFORM public.record_strike(v.owner_id, 'report');
  PERFORM public.kayak_send_home(v.voyage_id, 'reported');
  PERFORM public.kayak_ping(uid);
  RETURN TRUE;
END;
$$;

-- Hidden from everyone until reviewed. Callers: whoever has the Kayak now, or
-- its owner reading the log. An owner reporting also keeps that commenter's
-- harbour off their Kayaks, without ever learning who it is.
CREATE OR REPLACE FUNCTION public.report_comment(p_comment UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     UUID := auth.uid();
  c       public.kayak_comments%ROWTYPE;
  v_owner UUID;
  v_voy   UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_reason NOT IN ('sexual', 'harassment', 'spam', 'contact', 'other') THEN
    RAISE EXCEPTION 'unknown report reason' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO c FROM public.kayak_comments WHERE id = p_comment AND screen = 'ok' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  SELECT n.owner_id, n.voyage_id INTO v_owner, v_voy FROM public.kayak_notes n WHERE n.id = c.note_id;
  IF uid IS DISTINCT FROM v_owner AND NOT EXISTS (
    SELECT 1 FROM public.kayak_visits vi
    WHERE vi.voyage_id = v_voy AND vi.recipient_id = uid AND vi.left_at IS NULL
  ) THEN
    RETURN FALSE;
  END IF;
  IF c.reported_at IS NOT NULL THEN
    RETURN TRUE; -- a double tap, or already pulled
  END IF;

  UPDATE public.kayak_comments SET reported_at = now() WHERE id = p_comment;
  PERFORM public.enqueue_moderation('kayak_comment', p_comment, 'report', p_reason, TRUE);
  PERFORM public.record_strike(c.author_id, 'report');
  IF uid = v_owner AND c.author_id IS NOT NULL AND c.author_id <> uid THEN
    INSERT INTO public.kayak_blocks (blocker_id, blocked_id) VALUES (uid, c.author_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN TRUE;
END;
$$;

-- Blocks hide both ways, and the Kayak in hand sails on.
CREATE OR REPLACE FUNCTION public.block_visit(p_visit UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v   public.kayak_visits%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  v := public.kayak_my_visit(p_visit, uid);
  INSERT INTO public.kayak_blocks (blocker_id, blocked_id) VALUES (uid, v.owner_id)
  ON CONFLICT DO NOTHING;
  UPDATE public.kayak_visits SET left_at = now(), left_reason = 'blocked' WHERE id = p_visit;
  PERFORM public.kayak_next_leg(v.voyage_id);
  PERFORM public.kayak_ping(uid);
  RETURN TRUE;
END;
$$;

-- Blocked owners have no names to list, so undoing is all or nothing.
CREATE OR REPLACE FUNCTION public.unblock_all_kayaks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.kayak_blocks WHERE blocker_id = auth.uid();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.ack_kayak_notice(p_kind TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_kind = 'note' THEN
    UPDATE public.kayak_notes SET acked_at = now() WHERE id = p_id AND owner_id = auth.uid();
  ELSE
    UPDATE public.kayak_comments SET acked_at = now() WHERE id = p_id AND author_id = auth.uid();
  END IF;
  RETURN FOUND;
END;
$$;

-- ─── reads ──────────────────────────────────────────────────────────────────
-- The same answer shape for everyone; free members simply have nothing in it.
-- Writes: the activity bump, at most hourly, and the allowance top-up.
CREATE OR REPLACE FUNCTION public.get_harbour()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid    UUID := auth.uid();
  v_left INTEGER;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET last_active = now()
  WHERE id = uid AND (last_active IS NULL OR last_active < now() - interval '1 hour');
  v_left := public.kayak_topup(uid);

  RETURN jsonb_build_object(
    'keeper',  public.is_keeper(uid),
    'gems',    jsonb_build_object(
      'remaining', v_left,
      'stock',     (SELECT count(*) FROM public.gems WHERE owner_id = uid AND state = 'stock'),
      'refill_at', (SELECT next_refill_at FROM public.kayak_allowances WHERE user_id = uid)),
    'treasure', (SELECT count(*) FROM public.gems WHERE holder_id = uid AND state IN ('kept', 'reserved')),
    'kayaks',  COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id',     k.id,
          'look',   k.look,
          'aboard', (SELECT count(*) FROM public.gems g WHERE g.kayak_id = k.id AND g.state = 'aboard'),
          'state',  COALESCE(v.state, 'home'),
          -- Only while it's actually there, and never who.
          'city',   (SELECT vi.city FROM public.kayak_visits vi WHERE vi.voyage_id = v.id AND vi.left_at IS NULL),
          'new_comments', (
            SELECT count(*) FROM public.kayak_comments c
            JOIN public.kayak_notes n ON n.id = c.note_id
            JOIN public.voyages vv ON vv.id = n.voyage_id
            WHERE vv.kayak_id = k.id AND c.screen = 'ok' AND c.reported_at IS NULL
              AND c.created_at > k.log_seen_at))
        ORDER BY k.created_at)
      FROM public.kayaks k
      LEFT JOIN public.voyages v ON v.kayak_id = k.id AND v.state <> 'home'
      WHERE k.owner_id = uid
    ), '[]'::jsonb),
    -- Filter on the recipient's membership too: lapsed with the cron yet to run.
    'visitors', CASE WHEN public.is_keeper(uid) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'visit_id', vi.id,
          'look',     k.look,
          'aboard',   (SELECT count(*) FROM public.gems g WHERE g.kayak_id = k.id AND g.state = 'aboard'))
        ORDER BY vi.arrived_at)
      FROM public.kayak_visits vi
      JOIN public.voyages v ON v.id = vi.voyage_id
      JOIN public.kayaks k ON k.id = v.kayak_id
      WHERE vi.recipient_id = uid AND vi.left_at IS NULL AND public.owner_may_sail(vi.owner_id)
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    -- Held notes and comments, so the writer sees why and can rewrite.
    'notices', COALESCE((
      SELECT jsonb_agg(x ORDER BY x ->> 'at') FROM (
        SELECT jsonb_build_object('kind', 'note', 'id', n.id, 'reason', n.screen_reason,
                                  'body', n.body, 'at', n.created_at,
                                  'kayak_id', (SELECT kayak_id FROM public.voyages WHERE id = n.voyage_id)) AS x
        FROM public.kayak_notes n
        WHERE n.owner_id = uid AND n.screen = 'held' AND n.acked_at IS NULL AND n.reported_at IS NULL
        UNION ALL
        SELECT jsonb_build_object('kind', 'comment', 'id', c.id, 'reason', c.screen_reason,
                                  'body', c.body, 'at', c.created_at)
        FROM public.kayak_comments c
        WHERE c.author_id = uid AND c.screen = 'held' AND c.acked_at IS NULL AND c.reported_at IS NULL
      ) notices
    ), '[]'::jsonb));
END;
$$;

-- One of your Kayaks: its gems and its voyage log. Reading clears the marker.
CREATE OR REPLACE FUNCTION public.get_kayak(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  k   public.kayaks%ROWTYPE;
  v   public.voyages%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO k FROM public.kayaks WHERE id = p_id AND owner_id = uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v FROM public.voyages WHERE kayak_id = p_id AND state <> 'home';
  UPDATE public.kayaks SET log_seen_at = now() WHERE id = p_id;

  RETURN jsonb_build_object(
    'id',    k.id,
    'look',  k.look,
    'state', COALESCE(v.state, 'home'),
    'city',  (SELECT vi.city FROM public.kayak_visits vi WHERE vi.voyage_id = v.id AND vi.left_at IS NULL),
    'edits_left', CASE WHEN v.id IS NULL THEN NULL ELSE 3 - v.edits END,
    'edit_pending', v.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.kayak_notes n
      WHERE n.voyage_id = v.id AND n.screen IS NULL AND v.state IN ('sailing', 'visiting')),
    'note',  CASE WHEN v.id IS NULL THEN NULL ELSE COALESCE(
      (SELECT body FROM public.kayak_notes WHERE id = public.kayak_current_note(v.id)),
      (SELECT body FROM public.kayak_notes WHERE voyage_id = v.id ORDER BY created_at DESC LIMIT 1)) END,
    'gems',  COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'engine', g.engine, 'seed', g.seed) ORDER BY g.created_at)
      FROM public.gems g WHERE g.kayak_id = p_id AND g.state = 'aboard'
    ), '[]'::jsonb),
    'log',   COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id',         vy.id,
          'state',      vy.state,
          'started_at', vy.started_at,
          'ended_at',   vy.ended_at,
          'end_reason', vy.end_reason,
          'notes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',   n.id,
                'body', n.body,
                'at',   n.created_at,
                'comments', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'at', c.created_at) ORDER BY c.created_at)
                  FROM public.kayak_comments c
                  WHERE c.note_id = n.id AND c.screen = 'ok' AND c.reported_at IS NULL
                ), '[]'::jsonb))
              ORDER BY n.created_at)
            FROM public.kayak_notes n WHERE n.voyage_id = vy.id AND n.screen = 'ok'
          ), '[]'::jsonb))
        ORDER BY vy.started_at DESC)
      FROM public.voyages vy WHERE vy.kayak_id = p_id
    ), '[]'::jsonb));
END;
$$;

-- Yours forever, lapsed or not. "Reserved" reads as "on its way".
CREATE OR REPLACE FUNCTION public.get_treasure()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',      g.id,
      'engine',  g.engine,
      'seed',    g.seed,
      'state',   g.state,
      'kept_at', g.kept_at,
      'comment', CASE WHEN c.screen = 'ok' OR c.screen IS NULL THEN c.body END)
    ORDER BY COALESCE(g.kept_at, g.created_at) DESC), '[]'::jsonb)
  FROM public.gems g
  LEFT JOIN public.kayak_comments c ON c.id = g.comment_id
  WHERE g.holder_id = auth.uid() AND g.state IN ('kept', 'reserved');
$$;

-- A deleted account's unspent gems go with it. Kept gems stay with whoever kept them.
CREATE OR REPLACE FUNCTION public.delete_gems_of_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.gems WHERE owner_id = OLD.id AND state IN ('stock', 'aboard');
  RETURN OLD;
END;
$$;
CREATE TRIGGER delete_gems BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.delete_gems_of_profile();

-- ─── grants ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  f TEXT;
BEGIN
  -- Internal: no client ever calls these.
  FOREACH f IN ARRAY ARRAY[
    'kayak_ping(uuid)', 'owner_may_sail(uuid)', 'kayak_require_member()', 'kayak_current_note(uuid)',
    'kayak_topup(uuid)', 'kayak_send_home(uuid, text)', 'kayak_stay_ashore(uuid, text)',
    'kayak_next_leg(uuid)', 'kayak_release_gem(uuid)', 'kayak_keep_gem(uuid)', 'kayak_promote_note(uuid)',
    'apply_kayak_screen(text, uuid, text, text)', 'kayak_pick_recipient(uuid, uuid)',
    'kayak_post_email(jsonb)', 'advance_kayaks()', 'check_kayak_look(jsonb)',
    'kayak_my_visit(uuid, uuid)', 'delete_gems_of_profile()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- Signed-in members; each checks auth.uid() itself.
  FOREACH f IN ARRAY ARRAY[
    'save_kayak_look(uuid, jsonb)', 'delete_kayak(uuid)', 'load_gems(uuid, integer)',
    'unload_gem(uuid, uuid)', 'launch_kayak(uuid, text)', 'edit_note(uuid, text)', 'recall_kayak(uuid)',
    'get_visit(uuid)', 'leave_comment(uuid, uuid, text)', 'wave_on(uuid)', 'report_note(uuid, text)',
    'report_comment(uuid, text)', 'block_visit(uuid)', 'unblock_all_kayaks()',
    'ack_kayak_notice(text, uuid)', 'get_harbour()', 'get_kayak(uuid)', 'get_treasure()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.apply_kayak_screen(TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_kayaks() TO service_role;
