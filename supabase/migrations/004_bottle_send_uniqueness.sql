-- Migration: 004_bottle_send_uniqueness
-- Adds UNIQUE constraint on (sender_id, day_key) to make bottle sends fully atomic.
-- Without this, the RLS INSERT quota check and the INSERT itself are not atomic,
-- allowing a race condition where two concurrent sends from the same user could both succeed.
-- This constraint is the final line of defense.

ALTER TABLE public.bottles
  ADD CONSTRAINT bottles_sender_day_unique UNIQUE (sender_id, day_key);
