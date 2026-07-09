-- ============================================================================
-- Mindspace — Supabase schema (idempotent, safe to run repeatedly)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor. It creates the four sync tables if they
-- don't exist, adds any newer columns (scenes / threads / background), and sets
-- up Row-Level Security so each signed-in user can only read/write their own
-- rows. There are intentionally NO foreign keys between the tables: the client
-- syncs a whole canvas at once and must never have a single ordering/orphan
-- issue block a save. Timestamps are JS epoch millis (bigint).
-- ============================================================================

-- ---------- canvases -------------------------------------------------------
create table if not exists public.canvases (
  id            text primary key,
  user_id       uuid not null,
  title         text,
  theme_color   text,
  camera        jsonb,
  checkpoint    jsonb,
  scenes        jsonb default '[]'::jsonb,
  threads       jsonb default '[]'::jsonb,
  background    jsonb,
  last_modified bigint,
  category      text,
  is_favorite   boolean default false,
  archived      boolean default false,
  deleted       boolean default false
);

-- Add newer columns to a pre-existing table (no-ops if already present).
alter table public.canvases add column if not exists scenes     jsonb default '[]'::jsonb;
alter table public.canvases add column if not exists threads    jsonb default '[]'::jsonb;
alter table public.canvases add column if not exists background  jsonb;
alter table public.canvases add column if not exists checkpoint  jsonb;
alter table public.canvases add column if not exists category    text;
alter table public.canvases add column if not exists is_favorite boolean default false;
alter table public.canvases add column if not exists archived    boolean default false;
alter table public.canvases add column if not exists deleted     boolean default false;

-- ---------- canvas_objects -------------------------------------------------
create table if not exists public.canvas_objects (
  id         text primary key,
  canvas_id  text,
  user_id    uuid not null,
  type       text,
  x          double precision,
  y          double precision,
  width      double precision,
  height     double precision,
  content    text,
  style      jsonb default '{}'::jsonb,
  z_index    integer default 1,
  parent_id  text,
  rotation   double precision default 0,
  locked     boolean default false,
  created_at bigint,
  updated_at bigint
);
create index if not exists canvas_objects_user_idx   on public.canvas_objects (user_id);
create index if not exists canvas_objects_canvas_idx on public.canvas_objects (canvas_id);

-- ---------- drawing_strokes ------------------------------------------------
create table if not exists public.drawing_strokes (
  id             text primary key,
  canvas_id      text,
  user_id        uuid not null,
  points         jsonb,
  color          text,
  size           double precision,
  parent_id      text,
  is_highlighter boolean default false,
  created_at     bigint
);
create index if not exists drawing_strokes_user_idx   on public.drawing_strokes (user_id);
create index if not exists drawing_strokes_canvas_idx on public.drawing_strokes (canvas_id);

-- ---------- connections ----------------------------------------------------
create table if not exists public.connections (
  id         text primary key,
  canvas_id  text,
  user_id    uuid not null,
  from_id    text,
  to_id      text,
  parent_id  text,
  created_at bigint,
  style      jsonb default '{}'::jsonb
);
create index if not exists connections_user_idx   on public.connections (user_id);
create index if not exists connections_canvas_idx on public.connections (canvas_id);

-- ============================================================================
-- Row-Level Security — every user reads & writes only their own rows.
-- ============================================================================
alter table public.canvases       enable row level security;
alter table public.canvas_objects enable row level security;
alter table public.drawing_strokes enable row level security;
alter table public.connections    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['canvases','canvas_objects','drawing_strokes','connections']
  loop
    execute format('drop policy if exists "own_select" on public.%I', t);
    execute format('drop policy if exists "own_insert" on public.%I', t);
    execute format('drop policy if exists "own_update" on public.%I', t);
    execute format('drop policy if exists "own_delete" on public.%I', t);

    execute format('create policy "own_select" on public.%I for select using (auth.uid() = user_id)', t);
    execute format('create policy "own_insert" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "own_update" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "own_delete" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
