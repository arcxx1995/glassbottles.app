-- Migration 061: the Atelier becomes Shape, Glass and Seal.
--
--   shape   25 Keeper shapes plus the free classic. Geometry lives in
--           apps/web/lib/bottleShapes.ts; a test keeps the two lists equal.
--   glass,  12 hues x 3 pastel shades, replacing today's colours in the picker.
--   seal
--   paper,  No longer dressed. Notes use the standard paper and ink.
--   ink
--
-- Retired rows stay: bottles already sent still resolve their colours, and
-- check_bottle_style (058) still accepts them, so a client on an old catalogue
-- can throw. It needs no change: it looks each key up by kind and gates sort > 0,
-- which also means the server withholds `shape` from non-Keepers with the rest of
-- `style` (057). Additive, so this goes in before the client ships.

ALTER TABLE public.atelier_pieces DROP CONSTRAINT IF EXISTS atelier_pieces_kind_check;
ALTER TABLE public.atelier_pieces ADD CONSTRAINT atelier_pieces_kind_check
  CHECK (kind IN ('shape', 'glass', 'seal', 'paper', 'ink'));

ALTER TABLE public.atelier_pieces
  ADD COLUMN IF NOT EXISTS retired BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.atelier_pieces SET retired = TRUE
WHERE kind IN ('paper', 'ink') OR (kind IN ('glass', 'seal') AND sort > 0);

INSERT INTO public.atelier_pieces (kind, id, name, tier, look, sort)
SELECT 'shape', s.id, s.name, CASE WHEN s.sort = 0 THEN 'free' ELSE 'keeper' END, '{}'::jsonb, s.sort
FROM (VALUES
  ('classic',   'Classic',      0),
  ('fish',      'Fish',         1),
  ('seahorse',  'Seahorse',     2),
  ('whale',     'Whale',        3),
  ('octopus',   'Octopus',      4),
  ('turtle',    'Turtle',       5),
  ('shell',     'Shell',        6),
  ('starfish',  'Starfish',     7),
  ('anchor',    'Anchor',       8),
  ('jellyfish', 'Jellyfish',    9),
  ('rose',      'Rose',        10),
  ('tulip',     'Tulip',       11),
  ('lotus',     'Lotus',       12),
  ('leaf',      'Leaf',        13),
  ('mushroom',  'Mushroom',    14),
  ('pear',      'Pear',        15),
  ('apple',     'Apple',       16),
  ('acorn',     'Acorn',       17),
  ('snowflake', 'Snowflake',   18),
  ('potion',    'Potion',      19),
  ('decanter',  'Decanter',    20),
  ('face',      'Face',        21),
  ('cat',       'Cat',         22),
  ('owl',       'Owl',         23),
  ('lantern',   'Lantern',     24),
  ('ship',      'Little ship', 25)
) AS s(id, name, sort)
ON CONFLICT (kind, id) DO NOTHING;

-- Pastels, in spectrum order. Sort starts at 101 to sit after the retired rows.
WITH hues(hue, name, deg, h_sort) AS (VALUES
  ('rose',       'rose',       350,  0),
  ('coral',      'coral',       12,  1),
  ('peach',      'peach',       28,  2),
  ('butter',     'butter',      48,  3),
  ('lime',       'lime',        80,  4),
  ('mint',       'mint',       140,  5),
  ('seafoam',    'seafoam',    170,  6),
  ('sky',        'sky',        200,  7),
  ('periwinkle', 'periwinkle', 228,  8),
  ('lilac',      'lilac',      265,  9),
  ('orchid',     'orchid',     295, 10),
  ('blush',      'blush',      325, 11)
), shades(shade, label, sat, lit, s_sort) AS (VALUES
  ('pale', 'Pale', 70, 88, 0),
  ('soft', 'Soft', 65, 78, 1),
  ('deep', 'Deep', 55, 66, 2)
), colours AS (
  SELECT hue || '_' || shade AS id,
         label || ' ' || name AS name,
         format('hsl(%s %s%% %s%%)', deg, sat, lit) AS solid,
         format('hsl(%s %s%% %s%% / 0.3)', deg, sat, lit) AS tint,
         101 + h_sort * 3 + s_sort AS sort
  FROM hues CROSS JOIN shades
)
INSERT INTO public.atelier_pieces (kind, id, name, tier, look, sort)
SELECT 'glass', id, name, 'keeper', jsonb_build_object('tint', tint, 'edge', solid), sort FROM colours
UNION ALL
SELECT 'seal', id, name || ' wax', 'keeper', jsonb_build_object('wax', solid), sort FROM colours
ON CONFLICT (kind, id) DO NOTHING;
