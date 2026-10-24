-- Migration 050: the social layer (v2)
--
-- Pseudonymous handles, posts + votes + comments, friends, communities, and
-- wall scraps / testimonials. Bottles stay anonymous and untouched (The Sea);
-- nothing here links a handle to a bottle. Every table is RLS-on and
-- authenticated-only.
--
-- Integrity rules live here, not in the app:
--   * counters (score, comment_count) are written only by SECURITY DEFINER
--     triggers; clients have no UPDATE on posts at all;
--   * friendships: one row per pair, and accepting can only flip status;
--   * testimonials can't be self-written or self-approved;
--   * no client-supplied image URLs until uploads ship (a remote <img> would
--     leak every viewer's IP in a pseudonymous app);
--   * per-user rate limits on every write that reaches other people;
--   * posts, comments and scraps go through the safety screen (043's
--     screen-bottle function, social mode). Held rows are visible only to
--     their author. Fail-open like bottles: unscreened rows show.

-- ─── handles ──────────────────────────────────────────────────────────────────
-- Separate from `profiles` so no existing profile column becomes world-readable.
CREATE TABLE public.social_profiles (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  handle     TEXT NOT NULL CHECK (
               handle ~ '^[a-z0-9_]{3,20}$'
               AND handle NOT IN ('admin', 'administrator', 'glassbottles', 'glassbottle',
                                  'support', 'help', 'mod', 'moderator', 'staff', 'team',
                                  'official', 'system', 'root', 'keeper', 'sea', 'feed',
                                  'settings', 'inbox', 'logbook', 'null', 'undefined')),
  -- ponytail: no avatar uploads yet; allow a Storage URL when they ship.
  avatar_url TEXT CHECK (avatar_url IS NULL),
  bio        TEXT CHECK (char_length(bio) <= 280),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT social_profiles_handle_key UNIQUE (handle)
);
ALTER TABLE public.social_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp: read" ON public.social_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "sp: insert own" ON public.social_profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "sp: update own" ON public.social_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── communities ──────────────────────────────────────────────────────────────
CREATE TABLE public.communities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_-]{3,30}$'),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description TEXT CHECK (char_length(description) <= 500),
  created_by  UUID NOT NULL REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX communities_created_by_idx ON public.communities (created_by, created_at);
CREATE TABLE public.community_members (
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user_idx ON public.community_members (user_id);
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c: read" ON public.communities FOR SELECT TO authenticated USING (true);
CREATE POLICY "c: create" ON public.communities FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "cm: read" ON public.community_members FOR SELECT TO authenticated USING (true);
-- Joining is self-service as 'member'; the owner row comes from the trigger below.
CREATE POLICY "cm: join" ON public.community_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'member');
CREATE POLICY "cm: leave" ON public.community_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND role = 'member');

CREATE FUNCTION public.community_owner_member() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END $$;
CREATE TRIGGER communities_owner AFTER INSERT ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.community_owner_member();

-- ─── posts / votes / comments ─────────────────────────────────────────────────
CREATE TABLE public.posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     UUID NOT NULL REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  community_id  UUID REFERENCES public.communities(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  image_url     TEXT CHECK (image_url IS NULL), -- ponytail: uploads not built yet
  score         INT NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  screen        TEXT CHECK (screen IN ('ok', 'crisis', 'held')),
  screen_reason TEXT CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX posts_created_idx ON public.posts (created_at DESC);
CREATE INDEX posts_score_idx ON public.posts (score DESC, created_at DESC);
CREATE INDEX posts_community_idx ON public.posts (community_id, created_at DESC);
CREATE INDEX posts_author_idx ON public.posts (author_id, created_at DESC);

CREATE TABLE public.post_votes (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  value   SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE public.comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  parent_id     UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  screen        TEXT CHECK (screen IN ('ok', 'crisis', 'held')),
  screen_reason TEXT CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX comments_post_idx ON public.comments (post_id, created_at);
CREATE INDEX comments_author_idx ON public.comments (author_id, created_at);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p: read" ON public.posts FOR SELECT TO authenticated
  USING (screen IS DISTINCT FROM 'held' OR author_id = auth.uid());
-- A community post requires membership.
CREATE POLICY "p: insert" ON public.posts FOR INSERT TO authenticated WITH CHECK (
  author_id = auth.uid()
  AND (community_id IS NULL OR EXISTS (
    SELECT 1 FROM public.community_members m
    WHERE m.community_id = posts.community_id AND m.user_id = auth.uid()))
);
CREATE POLICY "p: delete own" ON public.posts FOR DELETE TO authenticated USING (author_id = auth.uid());
-- Votes: you only ever see (and change) your own; the public number is posts.score.
CREATE POLICY "v: read own" ON public.post_votes FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "v: insert own" ON public.post_votes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "v: update own" ON public.post_votes FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "v: delete own" ON public.post_votes FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cmt: read" ON public.comments FOR SELECT TO authenticated
  USING (screen IS DISTINCT FROM 'held' OR author_id = auth.uid());
CREATE POLICY "cmt: insert own" ON public.comments FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "cmt: delete own" ON public.comments FOR DELETE TO authenticated USING (author_id = auth.uid());

CREATE FUNCTION public.post_votes_score() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET score = score + NEW.value WHERE id = NEW.post_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Two statements so a vote whose post_id changed (upsert writes every
    -- column) still moves the right amount off the right post.
    UPDATE public.posts SET score = score - OLD.value WHERE id = OLD.post_id;
    UPDATE public.posts SET score = score + NEW.value WHERE id = NEW.post_id;
  ELSE
    UPDATE public.posts SET score = score - OLD.value WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER post_votes_score AFTER INSERT OR UPDATE OR DELETE ON public.post_votes
  FOR EACH ROW EXECUTE FUNCTION public.post_votes_score();

-- ponytail: a held comment still counts in comment_count (the author sees it);
-- reconcile in apply_social_screen if the mismatch ever matters.
CREATE FUNCTION public.comments_count() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE public.posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER comments_count AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_count();

-- ─── friends ──────────────────────────────────────────────────────────────────
CREATE TABLE public.friendships (
  requester_id UUID NOT NULL REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
-- One row per pair, whichever side asked first (no A→B plus B→A).
CREATE UNIQUE INDEX friendships_pair_key ON public.friendships
  (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX friendships_addressee_idx ON public.friendships (addressee_id);
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "f: read mine" ON public.friendships FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE POLICY "f: request" ON public.friendships FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid() AND status = 'pending');
CREATE POLICY "f: accept" ON public.friendships FOR UPDATE TO authenticated
  USING (addressee_id = auth.uid()) WITH CHECK (addressee_id = auth.uid() AND status = 'accepted');
CREATE POLICY "f: remove" ON public.friendships FOR DELETE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- ─── wall: scraps + testimonials ──────────────────────────────────────────────
-- Scraps show immediately; testimonials wait for the wall owner to approve.
CREATE TABLE public.scraps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wall_id       UUID NOT NULL REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES public.social_profiles(user_id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'scrap' CHECK (kind IN ('scrap', 'testimonial')),
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  approved      BOOLEAN NOT NULL DEFAULT TRUE,
  screen        TEXT CHECK (screen IN ('ok', 'crisis', 'held')),
  screen_reason TEXT CHECK (screen_reason IN ('contact', 'harm', 'sexual', 'spam')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind = 'scrap' OR wall_id <> author_id) -- no testimonials about yourself
);
CREATE INDEX scraps_wall_idx ON public.scraps (wall_id, created_at DESC);
CREATE INDEX scraps_author_idx ON public.scraps (author_id, created_at);
ALTER TABLE public.scraps ENABLE ROW LEVEL SECURITY;
-- Held: author only. Unapproved testimonial: author + wall owner.
CREATE POLICY "s: read" ON public.scraps FOR SELECT TO authenticated USING (
  author_id = auth.uid()
  OR (screen IS DISTINCT FROM 'held' AND (approved OR wall_id = auth.uid()))
);
-- Testimonials can't self-approve.
CREATE POLICY "s: write" ON public.scraps FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND approved = (kind = 'scrap'));
CREATE POLICY "s: owner approves" ON public.scraps FOR UPDATE TO authenticated
  USING (wall_id = auth.uid()) WITH CHECK (wall_id = auth.uid());
CREATE POLICY "s: delete" ON public.scraps FOR DELETE TO authenticated
  USING (wall_id = auth.uid() OR author_id = auth.uid());

-- ─── reports ──────────────────────────────────────────────────────────────────
-- ponytail: write-only for now; reviewed via the dashboard / SQL. Add an
-- auto-hide threshold if volume makes manual review impractical.
CREATE TABLE public.social_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'scrap', 'profile')),
  target_id   UUID NOT NULL,
  reason      TEXT CHECK (char_length(reason) <= 300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reporter_id, target_type, target_id)
);
ALTER TABLE public.social_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "r: insert own" ON public.social_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- ─── rate limits ──────────────────────────────────────────────────────────────
-- BEFORE INSERT, args: (max rows, window, actor column). Counts the actor's
-- rows in this table inside the window, held ones included.
CREATE FUNCTION public.social_rate_limit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_max    INT      := TG_ARGV[0]::INT;
  v_window INTERVAL := TG_ARGV[1]::INTERVAL;
  v_col    TEXT     := TG_ARGV[2];
  v_actor  UUID     := (to_jsonb(NEW) ->> v_col)::UUID;
  v_n      INT;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1 AND created_at > now() - $2',
                 TG_TABLE_NAME, v_col)
    INTO v_n USING v_actor, v_window;
  IF v_n >= v_max THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001',
      HINT = format('%s per %s', v_max, v_window);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posts_rate BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.social_rate_limit('20', '1 hour', 'author_id');
CREATE TRIGGER comments_rate BEFORE INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.social_rate_limit('60', '1 hour', 'author_id');
CREATE TRIGGER scraps_rate BEFORE INSERT ON public.scraps
  FOR EACH ROW EXECUTE FUNCTION public.social_rate_limit('30', '1 hour', 'author_id');
CREATE TRIGGER friendships_rate BEFORE INSERT ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.social_rate_limit('50', '1 day', 'requester_id');
CREATE TRIGGER communities_rate BEFORE INSERT ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.social_rate_limit('3', '1 day', 'created_by');

-- ─── safety screen (043, social mode) ─────────────────────────────────────────
-- Same Vault-configured pg_net path as screen_new_bottle; fire-and-forget,
-- never fails the insert.
CREATE FUNCTION public.screen_new_social() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT c.supabase_url, c.service_role_key INTO v_url, v_key
  FROM public._notify_config() c;
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/screen-bottle',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('table', TG_TABLE_NAME, 'id', NEW.id)
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'screen_new_social(%, %): %', TG_TABLE_NAME, NEW.id, SQLERRM;
  RETURN NULL;
END $$;
CREATE TRIGGER posts_screen AFTER INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.screen_new_social();
CREATE TRIGGER comments_screen AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.screen_new_social();
CREATE TRIGGER scraps_screen AFTER INSERT ON public.scraps
  FOR EACH ROW EXECUTE FUNCTION public.screen_new_social();

-- The Edge Function's only write for social rows. First verdict wins (pg_net
-- may deliver twice). A held row's author is told over their private channel.
CREATE FUNCTION public.apply_social_screen(
  p_table   TEXT,
  p_id      UUID,
  p_verdict TEXT,
  p_reason  TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_author UUID;
BEGIN
  IF p_table NOT IN ('posts', 'comments', 'scraps') THEN
    RAISE EXCEPTION 'bad table %', p_table;
  END IF;
  EXECUTE format(
    'UPDATE public.%I SET screen = $1, screen_reason = $2 WHERE id = $3 AND screen IS NULL RETURNING author_id',
    p_table)
    INTO v_author USING p_verdict, CASE WHEN p_verdict = 'held' THEN p_reason END, p_id;
  IF v_author IS NULL THEN
    RETURN 'already_screened_or_missing';
  END IF;
  IF p_verdict = 'held' THEN
    PERFORM realtime.send(jsonb_build_object('table', p_table, 'id', p_id),
                          'social_held', 'user:' || v_author::text, true);
  END IF;
  RETURN p_verdict;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_social_screen(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_social_screen(TEXT, UUID, TEXT, TEXT) TO service_role;

-- Trigger-only helpers: nobody calls these directly.
REVOKE EXECUTE ON FUNCTION public.social_rate_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.screen_new_social() FROM PUBLIC, anon, authenticated;

-- ─── grants ───────────────────────────────────────────────────────────────────
-- Stated, not inherited (same reason as 040): prod's legacy default
-- privileges hand new tables GRANT ALL to anon + authenticated, while the
-- local CLI, CI and branch DBs hand out nothing. Reset to none, then grant
-- exactly what the app uses, so every environment matches. RLS still decides
-- which rows.
REVOKE ALL ON public.social_profiles, public.communities, public.community_members,
  public.posts, public.post_votes, public.comments, public.friendships,
  public.scraps, public.social_reports
  FROM anon, authenticated;

GRANT SELECT, INSERT ON public.social_profiles TO authenticated;
-- Bio only. Handles are permanent for now (a rename breaks every @mention and
-- shared profile link); avatar_url waits for uploads.
GRANT UPDATE (bio) ON public.social_profiles TO authenticated;

GRANT SELECT, INSERT ON public.communities TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_members TO authenticated;

-- No client UPDATE on posts or comments: score / comment_count / screen are
-- trigger- and service-owned.
GRANT SELECT, INSERT, DELETE ON public.posts, public.comments TO authenticated;
-- Full UPDATE: supabase-js upsert writes every column in ON CONFLICT DO
-- UPDATE. RLS pins user_id; the score trigger handles a moved post_id.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_votes TO authenticated;

-- Accepting flips status and nothing else: otherwise the addressee could
-- rewrite requester_id and forge an accepted friendship with anyone.
GRANT SELECT, INSERT, DELETE ON public.friendships TO authenticated;
GRANT UPDATE (status) ON public.friendships TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.scraps TO authenticated;
GRANT UPDATE (approved) ON public.scraps TO authenticated;

GRANT INSERT ON public.social_reports TO authenticated;

-- Server side (screen-bottle reads rows; account deletion + ops tooling).
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.social_profiles, public.communities, public.community_members,
     public.posts, public.post_votes, public.comments, public.friendships,
     public.scraps, public.social_reports
  TO service_role;

-- ─── realtime: new posts ──────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
