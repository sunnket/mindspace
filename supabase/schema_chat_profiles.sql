-- ============================================================================
-- Mindspace — Chat profile identity (idempotent, safe to run repeatedly)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor AFTER schema_chat.sql.
--
-- Why this exists: the chat showed only the first two letters of a person's
-- handle, never the name and photo they set in "My Profile". The reason was a
-- split identity — the profile modal saved `full_name` and `avatar_url` into
-- auth.users.user_metadata, but the chat reads the PUBLIC `profiles` table,
-- which only had `username` and no avatar. Other users can't read your
-- auth.users row, so the display name / photo never crossed over.
--
-- This migration gives `profiles` the two columns the chat needs, keeps them
-- in sync for new signups, backfills existing users from their metadata, and
-- teaches `search_profiles` to return them. The client (ProfileModal) also
-- upserts these on save, so an edit shows up for the other side immediately.
-- ============================================================================

-- 1) The columns the chat renders. Nullable + additive — nothing breaks if a
--    row has neither yet (the UI falls back to the username, then initials).
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url   text;

-- 2) New signups: seed display_name / avatar_url from the metadata Supabase
--    Auth already carries (full_name + avatar_url, and common OAuth variants).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $trigger_body$
declare
  base_username text;
  final_username text;
begin
  base_username := coalesce(nullif(split_part(new.email, '@', 1), ''), 'user');
  final_username := base_username;
  while exists (select 1 from public.profiles where username = final_username) loop
    final_username := base_username || '_' || substr(md5(random()::text), 1, 4);
  end loop;

  insert into public.profiles (id, username, email, created_at, display_name, avatar_url)
  values (
    new.id,
    final_username,
    new.email,
    (extract(epoch from now()) * 1000)::bigint,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      final_username
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$trigger_body$;

-- 3) Backfill everyone who signed up before this ran, from their metadata.
--    Only fills blanks, so re-running is a no-op and never clobbers an edit.
update public.profiles p
set
  display_name = coalesce(
    p.display_name,
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    p.username
  ),
  avatar_url = coalesce(
    p.avatar_url,
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture'
  )
from auth.users u
where u.id = p.id
  and (p.display_name is null or p.avatar_url is null);

-- 4) search_profiles now returns the display name + photo too, so a person you
--    search for shows up with their real face and name, not initials.
--    Return-type change means the old signature must be dropped first.
drop function if exists public.search_profiles(text);
create function public.search_profiles(query text)
returns table (id uuid, username text, display_name text, avatar_url text)
language sql
security definer set search_path = public
stable
as $search_body$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where query is not null and length(trim(query)) > 0
    and (
      p.username ilike '%' || query || '%'
      or p.email ilike '%' || query || '%'
      or p.display_name ilike '%' || query || '%'
    )
    and p.id <> auth.uid()
  order by coalesce(p.display_name, p.username) asc
  limit 20;
$search_body$;

grant execute on function public.search_profiles(text) to authenticated;
