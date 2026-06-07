-- Migration: 001_init_schema
-- Creates core tables for glassbottles.app

-- Profiles: extends Supabase auth.users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ
);
COMMENT ON TABLE public.profiles IS 'One profile per auth user. Created automatically via trigger.';

-- Bottles: the core message container
CREATE TABLE public.bottles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES profiles(id),
  receiver_id UUID REFERENCES profiles(id),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  received_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT FALSE,
  is_reported BOOLEAN DEFAULT FALSE,
  is_stale BOOLEAN DEFAULT FALSE,
  day_key DATE DEFAULT CURRENT_DATE
);
COMMENT ON TABLE public.bottles IS 'One bottle per sender per day. receiver_id assigned by edge function only.';

-- Daily quotas: keyed by user+date. New day = new row = automatic reset.
CREATE TABLE public.daily_quotas (
  user_id UUID REFERENCES profiles(id),
  date DATE DEFAULT CURRENT_DATE,
  has_sent BOOLEAN DEFAULT FALSE,
  has_received BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (user_id, date)
);
COMMENT ON TABLE public.daily_quotas IS 'Quota resets implicitly: each new date produces a new row.';

-- Indexes
CREATE INDEX idx_bottles_sender_id ON bottles(sender_id);
CREATE INDEX idx_bottles_receiver_id ON bottles(receiver_id);
CREATE INDEX idx_bottles_day_key ON bottles(day_key);
CREATE INDEX idx_bottles_unmatched ON bottles(received_at) WHERE received_at IS NULL AND is_stale = FALSE;
CREATE INDEX idx_daily_quotas_user_date ON daily_quotas(user_id, date);

-- Trigger: auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
