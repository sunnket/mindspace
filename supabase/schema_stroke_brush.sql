-- ============================================================================
-- Mindspace — persist the full brush character of a drawing stroke
-- ----------------------------------------------------------------------------
-- Run in the Supabase SQL editor after schema.sql. Idempotent.
--
-- Bug it fixes: drawing_strokes only stored points/color/size/is_highlighter,
-- so texture, opacity, flow, hardness, smoothing, stabilization, pressure and
-- blendMode were dropped on every cloud round-trip. A chalk or watercolour
-- stroke came back as a plain line — "the texture changes on its own after I
-- reopen the canvas". One jsonb column carries them all, so future brush knobs
-- need no further migration.
-- ============================================================================

alter table public.drawing_strokes
  add column if not exists brush jsonb default '{}'::jsonb;
