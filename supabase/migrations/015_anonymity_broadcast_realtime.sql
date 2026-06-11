-- Migration 015: close the Realtime anonymity leak + column-level SELECT lockdown
--
-- THE LEAK:
--   RealtimeBottleListener subscribed to postgres_changes on public.bottles.
--   WALRUS authorizes subscribers via the RLS SELECT policies, which grant
--   whole-row access — so UPDATE payloads delivered to a receiver included
--   sender_id (and payloads to a sender included receiver_id). Anyone with
--   devtools open could de-anonymize their counterpart. REPLICA IDENTITY FULL
--   (migration 008) additionally exposed full OLD row images.
--
-- THE FIX (two layers):
--   1. Replace postgres_changes with database-triggered Realtime Broadcast on
--      private per-user topics ('user:<uuid>'). The payload contains ONLY what
--      the trigger explicitly sends — identity columns never leave the DB.
--   2. Column-level SELECT lockdown on public.bottles: the authenticated role
--      can no longer SELECT sender_id / receiver_id at all (same pattern as
--      migration 005 did for UPDATE). RLS policies still work — policy
--      expressions are part of the table definition and are exempt from
--      column-level privilege checks (proven in production by migration 005,
--      whose UPDATE policy references receiver_id).
--
-- DEPENDENCY / ORDERING:
--   Apply this migration together with the app deploy that rewrites
--   RealtimeBottleListener to broadcast channels and drops the redundant
--   .eq('receiver_id', ...) filters in the read/report routes — those filters
--   would fail the new column ACL (WHERE clauses require SELECT privilege).

-- ── 1. Broadcast trigger: notify both parties when a bottle is matched ──────
CREATE OR REPLACE FUNCTION public.notify_bottle_matched()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fire only on the unmatched → matched transition. Unrelated updates
  -- (is_read, is_reported, is_stale) never reach the trigger body's send.
  IF OLD.received_at IS NULL AND NEW.received_at IS NOT NULL THEN
    -- Receiver: "a bottle arrived". No sender information in the payload.
    PERFORM realtime.send(
      jsonb_build_object('bottle_id', NEW.id),
      'bottle_received',
      'user:' || NEW.receiver_id::text,
      true  -- private channel
    );
    -- Sender: "your bottle was delivered". No receiver information.
    PERFORM realtime.send(
      jsonb_build_object('bottle_id', NEW.id),
      'bottle_delivered',
      'user:' || NEW.sender_id::text,
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_bottle_matched ON public.bottles;
CREATE TRIGGER on_bottle_matched
  AFTER UPDATE OF received_at ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_bottle_matched();

-- ── 2. Authorize private per-user broadcast topics ──────────────────────────
-- Clients may only receive broadcasts on their own 'user:<their auth.uid()>'
-- topic. No client-to-client sends (SELECT/receive only — no INSERT policy).
DROP POLICY IF EXISTS "users receive own broadcasts" ON realtime.messages;
CREATE POLICY "users receive own broadcasts" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() = 'user:' || (SELECT auth.uid())::text
    AND extension = 'broadcast'
  );

-- ── 3. Column-level SELECT lockdown on bottles ──────────────────────────────
-- sender_id / receiver_id are never selectable by clients again, even if a
-- future client-side query or realtime feature touches the table directly.
-- Server reads use SECURITY DEFINER RPCs (migration 014) or the service role,
-- neither of which is affected.
REVOKE SELECT ON public.bottles FROM authenticated;
REVOKE SELECT ON public.bottles FROM anon;
GRANT SELECT (id, message, sent_at, received_at, read_at, day_key, is_read, is_reported, is_stale)
  ON public.bottles TO authenticated;

-- ── 4. Retire postgres_changes plumbing for bottles ─────────────────────────
-- Nothing subscribes to postgres_changes on bottles anymore. Dropping the
-- table from the publication stops WAL decoding for it, and reverting
-- REPLICA IDENTITY to DEFAULT removes the full-old-row WAL amplification
-- introduced by migration 008.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_publication_tables
    WHERE  pubname    = 'supabase_realtime'
      AND  schemaname = 'public'
      AND  tablename  = 'bottles'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.bottles;
  END IF;
END;
$$;

ALTER TABLE public.bottles REPLICA IDENTITY DEFAULT;

COMMENT ON TABLE public.bottles IS
  'One bottle per sender per day. receiver_id assigned by edge function only. '
  'Realtime notifications via notify_bottle_matched() broadcast trigger (migration 015); '
  'sender_id/receiver_id are not client-selectable (column-level ACL).';
