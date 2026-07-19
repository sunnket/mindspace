-- ===========================================================================
-- View-only share links.
--
-- A share stores a self-contained JSON SNAPSHOT of a board (title, background,
-- objects, connections, strokes) so the public viewer needs no access to the
-- owner's private tables. Owners manage their own rows under RLS; anonymous
-- viewers read a single non-revoked snapshot through a SECURITY DEFINER function
-- gated by an unguessable token (so RLS on the base tables is never relaxed).
-- ===========================================================================

create table if not exists public.shares (
  token       text primary key,
  user_id     uuid not null,
  canvas_id   text,                     -- which board this link points at (to find/refresh an existing link)
  title       text,
  data        jsonb not null,           -- the board snapshot
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  revoked     boolean default false
);

create index if not exists shares_user_canvas_idx on public.shares (user_id, canvas_id);

alter table public.shares enable row level security;

drop policy if exists "shares_own_select" on public.shares;
drop policy if exists "shares_own_insert" on public.shares;
drop policy if exists "shares_own_update" on public.shares;
drop policy if exists "shares_own_delete" on public.shares;

create policy "shares_own_select" on public.shares for select using (auth.uid() = user_id);
create policy "shares_own_insert" on public.shares for insert with check (auth.uid() = user_id);
create policy "shares_own_update" on public.shares for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "shares_own_delete" on public.shares for delete using (auth.uid() = user_id);

-- Public read path: returns the snapshot for a valid, non-revoked token only.
-- SECURITY DEFINER runs with the function owner's rights, so it can read the row
-- despite RLS — but it only ever exposes the one board the token names.
create or replace function public.get_shared_board(share_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select case when revoked then null else data end
  from public.shares
  where token = share_token
  limit 1;
$$;

grant execute on function public.get_shared_board(text) to anon, authenticated;
