-- Migration: 002_rls_policies
-- Row Level Security for all tables. Deny by default.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bottles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quotas ENABLE ROW LEVEL SECURITY;

-- ─── profiles ─────────────────────────────────────────────────────────────────

CREATE POLICY "profiles: read own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles: update own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- INSERT and DELETE blocked (trigger handles creation, cascade handles deletion)

-- ─── bottles ──────────────────────────────────────────────────────────────────

-- Sender can see their own sent bottles
CREATE POLICY "bottles: sender reads own" ON public.bottles
  FOR SELECT USING (auth.uid() = sender_id);

-- Receiver can see bottles addressed to them (message + metadata, not sender identity)
CREATE POLICY "bottles: receiver reads own" ON public.bottles
  FOR SELECT USING (auth.uid() = receiver_id);

-- Sender inserts their bottle only if quota not yet used today
CREATE POLICY "bottles: sender inserts with quota check" ON public.bottles
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND NOT EXISTS (
      SELECT 1 FROM public.daily_quotas
      WHERE user_id = auth.uid()
        AND date = CURRENT_DATE
        AND has_sent = TRUE
    )
  );

-- Receiver can mark bottle as read or reported; no other client updates
CREATE POLICY "bottles: receiver marks read or reported" ON public.bottles
  FOR UPDATE USING (auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = receiver_id);

-- ─── daily_quotas ─────────────────────────────────────────────────────────────

CREATE POLICY "daily_quotas: read own" ON public.daily_quotas
  FOR SELECT USING (auth.uid() = user_id);

-- No client INSERT/UPDATE — edge function uses service role
