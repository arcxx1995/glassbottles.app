-- Migration 062: the wine bottle joins the Atelier's shapes.
-- Geometry lives in apps/web/lib/bottleShapes.ts. Additive, like 061.

INSERT INTO public.atelier_pieces (kind, id, name, tier, look, sort)
VALUES ('shape', 'wine', 'Wine bottle', 'keeper', '{}'::jsonb, 26)
ON CONFLICT (kind, id) DO NOTHING;
