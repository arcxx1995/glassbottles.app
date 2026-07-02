-- migration 028: reply threads (mutual-consent pen-pal, first paid feature)
--
-- Flow: receiver of a bottle (Plus user) initiates → pending thread created →
-- original sender notified → accepts or declines. Only on mutual accept do
-- messages flow. Anonymity holds: initiator_id/recipient_id/author_id are
-- column-ACL'd; clients receive role:'initiator'|'recipient' + is_mine:bool.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Plus flag on profiles (paywall gate for initiating threads)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_plus BOOLEAN NOT NULL DEFAULT FALSE;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. threads table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE threads (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bottle_id    UUID        NOT NULL REFERENCES bottles(id),
  -- identity columns; column-level ACL (below) prevents client SELECT
  initiator_id UUID        NOT NULL REFERENCES profiles(id),
  recipient_id UUID        NOT NULL REFERENCES profiles(id),
  status       TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','active','declined')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at  TIMESTAMPTZ,
  UNIQUE(bottle_id) -- one thread per bottle
);

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "threads_participant_select" ON threads FOR SELECT
  USING (initiator_id = auth.uid() OR recipient_id = auth.uid());
-- RLS expressions are exempt from column-level privileges (same pattern as
-- sender_id/receiver_id on bottles, mig 015); clients cannot .select() these
-- columns directly but policies can reference them.
REVOKE SELECT (initiator_id, recipient_id) ON threads FROM authenticated, anon;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. thread_messages table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE thread_messages (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID        NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id UUID        NOT NULL REFERENCES profiles(id),
  message   TEXT        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at   TIMESTAMPTZ
);

ALTER TABLE thread_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "thread_messages_participant_select" ON thread_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM threads t
      WHERE t.id = thread_id
        AND (t.initiator_id = auth.uid() OR t.recipient_id = auth.uid())
    )
  );
REVOKE SELECT (author_id) ON thread_messages FROM authenticated, anon;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Realtime broadcasts (private channel 'user:<uuid>', same as bottles)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_thread_initiated()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('thread_id', NEW.id),
    'thread_initiated',
    'user:' || NEW.recipient_id::text,
    false
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION notify_thread_initiated() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_thread_initiated
  AFTER INSERT ON threads
  FOR EACH ROW EXECUTE FUNCTION notify_thread_initiated();

-- ─── thread accepted → notify initiator ─────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_thread_accepted()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    PERFORM realtime.send(
      jsonb_build_object('thread_id', NEW.id),
      'thread_accepted',
      'user:' || NEW.initiator_id::text,
      false
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION notify_thread_accepted() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_thread_accepted
  AFTER UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION notify_thread_accepted();

-- ─── new message → notify the other participant ──────────────────────────────
CREATE OR REPLACE FUNCTION notify_thread_message()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_other_id UUID;
BEGIN
  SELECT CASE
    WHEN t.initiator_id = NEW.author_id THEN t.recipient_id
    ELSE t.initiator_id
  END INTO v_other_id
  FROM threads t WHERE t.id = NEW.thread_id;

  IF v_other_id IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('thread_id', NEW.thread_id),
      'thread_message',
      'user:' || v_other_id::text,
      false
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION notify_thread_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_thread_message
  AFTER INSERT ON thread_messages
  FOR EACH ROW EXECUTE FUNCTION notify_thread_message();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC: initiate_thread(p_bottle_id) → {thread_id, status}
--    Only the receiver of a bottle can initiate; requires Plus.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION initiate_thread(p_bottle_id UUID)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_sender_id UUID;
  v_thread_id UUID;
  v_status    TEXT;
  v_is_plus   BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT is_plus INTO v_is_plus FROM profiles WHERE id = v_uid;
  IF NOT COALESCE(v_is_plus, false) THEN
    RETURN jsonb_build_object('error', 'plus_required');
  END IF;

  -- Caller must be the receiver of this non-stale delivered bottle
  SELECT sender_id INTO v_sender_id
  FROM bottles
  WHERE id = p_bottle_id
    AND receiver_id = v_uid
    AND received_at IS NOT NULL
    AND is_stale = false;

  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Bottle not found or not received by caller' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: return existing thread if already initiated for this bottle
  SELECT id, status INTO v_thread_id, v_status FROM threads WHERE bottle_id = p_bottle_id;
  IF FOUND THEN
    RETURN jsonb_build_object('thread_id', v_thread_id, 'status', v_status, 'already_exists', true);
  END IF;

  INSERT INTO threads (bottle_id, initiator_id, recipient_id)
  VALUES (p_bottle_id, v_uid, v_sender_id)
  RETURNING id INTO v_thread_id;

  RETURN jsonb_build_object('thread_id', v_thread_id, 'status', 'pending');
END;
$$;
REVOKE EXECUTE ON FUNCTION initiate_thread(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION initiate_thread(UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPC: accept_thread(p_thread_id) → {thread_id, status}
--    Only the original bottle sender (recipient in the thread) can accept.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_thread(p_thread_id UUID)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT status INTO v_status
  FROM threads
  WHERE id = p_thread_id AND recipient_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread not found' USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('thread_id', p_thread_id, 'status', v_status, 'already_resolved', true);
  END IF;

  UPDATE threads SET status = 'active', accepted_at = now() WHERE id = p_thread_id;

  RETURN jsonb_build_object('thread_id', p_thread_id, 'status', 'active');
END;
$$;
REVOKE EXECUTE ON FUNCTION accept_thread(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION accept_thread(UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. RPC: decline_thread(p_thread_id)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION decline_thread(p_thread_id UUID)
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

  UPDATE threads
  SET status = 'declined'
  WHERE id = p_thread_id AND recipient_id = v_uid AND status = 'pending';
END;
$$;
REVOKE EXECUTE ON FUNCTION decline_thread(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION decline_thread(UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. RPC: send_thread_message(p_thread_id, p_message) → {id, thread_id, sent_at}
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION send_thread_message(p_thread_id UUID, p_message TEXT)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_thread threads%ROWTYPE;
  v_msg_id UUID;
  v_now    TIMESTAMPTZ := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_thread
  FROM threads
  WHERE id = p_thread_id
    AND (initiator_id = v_uid OR recipient_id = v_uid);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread not found' USING ERRCODE = '42501';
  END IF;

  IF v_thread.status <> 'active' THEN
    RAISE EXCEPTION 'Thread is not active' USING ERRCODE = '23514';
  END IF;

  INSERT INTO thread_messages (thread_id, author_id, message, sent_at)
  VALUES (p_thread_id, v_uid, p_message, v_now)
  RETURNING id INTO v_msg_id;

  RETURN jsonb_build_object('id', v_msg_id, 'thread_id', p_thread_id, 'sent_at', v_now);
END;
$$;
REVOKE EXECUTE ON FUNCTION send_thread_message(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION send_thread_message(UUID, TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. RPC: get_threads() — all threads for caller, identity-safe
--    role: 'initiator' (I received the bottle and asked to talk)
--       | 'recipient' (I sent the original bottle; someone wants to reply)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_threads()
RETURNS TABLE (
  id              UUID,
  bottle_id       UUID,
  bottle_message  TEXT,
  status          TEXT,
  role            TEXT,
  created_at      TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  last_message    TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count    BIGINT
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT
    t.id,
    t.bottle_id,
    b.message AS bottle_message,
    t.status,
    CASE WHEN t.initiator_id = auth.uid() THEN 'initiator' ELSE 'recipient' END AS role,
    t.created_at,
    t.accepted_at,
    (SELECT tm.message  FROM thread_messages tm WHERE tm.thread_id = t.id ORDER BY tm.sent_at DESC LIMIT 1) AS last_message,
    (SELECT tm.sent_at  FROM thread_messages tm WHERE tm.thread_id = t.id ORDER BY tm.sent_at DESC LIMIT 1) AS last_message_at,
    (SELECT COUNT(*)    FROM thread_messages tm
      WHERE tm.thread_id = t.id AND tm.author_id <> auth.uid() AND tm.read_at IS NULL
    ) AS unread_count
  FROM threads t
  JOIN bottles b ON b.id = t.bottle_id
  WHERE t.initiator_id = auth.uid() OR t.recipient_id = auth.uid()
  ORDER BY COALESCE(
    (SELECT MAX(tm.sent_at) FROM thread_messages tm WHERE tm.thread_id = t.id),
    t.created_at
  ) DESC;
$$;
REVOKE EXECUTE ON FUNCTION get_threads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_threads() TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. RPC: get_thread_messages(p_thread_id) — is_mine replaces author_id
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_thread_messages(p_thread_id UUID)
RETURNS TABLE (
  id        UUID,
  thread_id UUID,
  message   TEXT,
  sent_at   TIMESTAMPTZ,
  read_at   TIMESTAMPTZ,
  is_mine   BOOLEAN
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT
    tm.id,
    tm.thread_id,
    tm.message,
    tm.sent_at,
    tm.read_at,
    tm.author_id = auth.uid() AS is_mine
  FROM thread_messages tm
  JOIN threads t ON t.id = tm.thread_id
  WHERE tm.thread_id = p_thread_id
    AND (t.initiator_id = auth.uid() OR t.recipient_id = auth.uid())
  ORDER BY tm.sent_at ASC;
$$;
REVOKE EXECUTE ON FUNCTION get_thread_messages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_thread_messages(UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. RPC: mark_thread_read(p_thread_id) — stamps read_at on other party's msgs
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_thread_read(p_thread_id UUID)
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

  UPDATE thread_messages tm
  SET read_at = now()
  FROM threads t
  WHERE tm.thread_id = p_thread_id
    AND t.id = p_thread_id
    AND (t.initiator_id = v_uid OR t.recipient_id = v_uid)
    AND tm.author_id <> v_uid
    AND tm.read_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION mark_thread_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_thread_read(UUID) TO authenticated;
