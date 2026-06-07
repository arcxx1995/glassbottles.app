-- Seed data for local development only.
-- Never run against production.

DO $$
BEGIN
  -- Guard: only run in local dev (Supabase local uses 'postgres' db name)
  IF current_database() != 'postgres' THEN
    RAISE NOTICE 'Skipping seed: not local dev database';
    RETURN;
  END IF;

  -- Test user UUIDs (these must match auth.users rows created via supabase local)
  -- Create test users first via: supabase auth user create
  -- Then replace these UUIDs with the actual ones from `supabase auth users list`
  --
  -- INSERT INTO public.profiles (id)
  -- VALUES
  --   ('00000000-0000-0000-0000-000000000001'),
  --   ('00000000-0000-0000-0000-000000000002'),
  --   ('00000000-0000-0000-0000-000000000003');
  --
  -- INSERT INTO public.bottles (sender_id, message, day_key)
  -- VALUES (
  --   '00000000-0000-0000-0000-000000000001',
  --   'This is a test bottle from user 1.',
  --   CURRENT_DATE
  -- );

  RAISE NOTICE 'Seed skipped: uncomment and add real UUIDs from supabase auth users list';
END;
$$;
