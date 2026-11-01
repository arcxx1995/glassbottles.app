-- Migration 060: four more currents, First Snow, Soft Rain, First Light and
-- Amber Fall. Widens the two CHECKs from 042; the list lives in lib/dressing.ts too.
-- Additive: live clients keep working, so this goes in before the client ships.

ALTER TABLE public.bottles DROP CONSTRAINT IF EXISTS bottles_current_check;
ALTER TABLE public.bottles ADD CONSTRAINT bottles_current_check CHECK (current IN (
  'night_owl', 'quiet_wins', 'heavy_water', 'busy_minds',
  'first_snow', 'soft_rain', 'first_light', 'amber_fall'
));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_current_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_current_check CHECK (current IN (
  'night_owl', 'quiet_wins', 'heavy_water', 'busy_minds',
  'first_snow', 'soft_rain', 'first_light', 'amber_fall'
));
