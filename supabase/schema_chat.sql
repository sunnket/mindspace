-- ============================================================================
-- Mindspace — Chat schema (idempotent, safe to run repeatedly)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor, after schema.sql. Additive/independent
-- of the four canvas-sync tables. Adds: `profiles` (auto-populated from
-- auth.users, used only for username/email lookup — plus a backfill for any
-- account that existed before this migration ran, since the trigger only
-- fires on new signups), `chat_rooms` (exactly one room per unordered pair
-- of users — 1:1 DMs only, group chat is future work), `chat_messages`
-- (durable message log with an `attachments` jsonb array, pushed live via
-- Supabase Realtime "Postgres Changes", NOT the broadcast-channel pattern
-- collab/service.ts uses — chat messages are already durably written to
-- Postgres first, so Postgres Changes is the idiomatic way to get realtime
-- push on top of a real table; collab's ephemeral broadcast pattern has no
-- durable backing store so it needs the different approach), and a private
-- `chat-attachments` Storage bucket (first use of Storage in this codebase)
-- for image/video/file attachments, RLS-scoped to the two room participants.
--
-- Conventions carried over from schema.sql: client-generated `text` uuid
-- primary keys, `uuid not null` owner columns with NO explicit FK to
-- auth.users (same "no FK blocks a write" philosophy), bigint epoch-millis
-- timestamps, `create index if not exists`, RLS with drop-then-create
-- policies. Unlike schema.sql's single-owner `auth.uid() = user_id`
-- predicate, chat tables are two-party — policies use
-- `auth.uid() = user_a or auth.uid() = user_b` (rooms) and an `exists(...)`
-- against the parent room (messages).
-- ============================================================================

-- ---------- profiles --------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key,
  username   text unique,
  email      text,
  created_at bigint
);
create index if not exists profiles_username_idx on public.profiles (username);

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

  insert into public.profiles (id, username, email, created_at)
  values (new.id, final_username, new.email, (extract(epoch from now()) * 1000)::bigint)
  on conflict (id) do nothing;

  return new;
end;
$trigger_body$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: the trigger above only fires for NEW signups going forward —
-- any account created before this migration ran has no profiles row at
-- all, so it can never be found by search_profiles no matter what's typed.
-- Looping row-by-row (not a single bulk INSERT) so each user's uniqueness
-- check sees the previous iteration's insert. Idempotent — re-running finds
-- nothing left to backfill.
do $backfill_guard$
declare
  u record;
  base_username text;
  final_username text;
begin
  for u in
    select au.id, au.email, au.created_at
    from auth.users au
    where not exists (select 1 from public.profiles p where p.id = au.id)
  loop
    base_username := coalesce(nullif(split_part(u.email, '@', 1), ''), 'user');
    final_username := base_username;
    while exists (select 1 from public.profiles where username = final_username) loop
      final_username := base_username || '_' || substr(md5(random()::text), 1, 4);
    end loop;

    insert into public.profiles (id, username, email, created_at)
    values (u.id, final_username, u.email, (extract(epoch from u.created_at) * 1000)::bigint)
    on conflict (id) do nothing;
  end loop;
end $backfill_guard$;

-- Server-side search — returns only id + username, never raw auth.users rows.
create or replace function public.search_profiles(query text)
returns table (id uuid, username text)
language sql
security definer set search_path = public
stable
as $search_body$
  select p.id, p.username
  from public.profiles p
  where query is not null and length(trim(query)) > 0
    and (p.username ilike '%' || query || '%' or p.email ilike '%' || query || '%')
    and p.id <> auth.uid()
  order by p.username asc
  limit 20;
$search_body$;

grant execute on function public.search_profiles(text) to authenticated;

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_any" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_any" on public.profiles for select using (auth.uid() is not null);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- chat_rooms -------------------------------------------------------
-- Two fixed columns instead of a members-junction table: junction-table RLS
-- for inserting a row that names someone else as a member is awkward under
-- RLS, and this app is 1:1-only for this pass. Group chat is explicit future
-- work and would need a junction-table redesign.
create table if not exists public.chat_rooms (
  id                    text primary key,
  user_a                uuid not null,
  user_b                uuid not null,
  created_at            bigint not null,
  last_message_at       bigint,
  last_message_preview  text
);
create unique index if not exists chat_rooms_pair_idx
  on public.chat_rooms (least(user_a, user_b), greatest(user_a, user_b));
create index if not exists chat_rooms_user_a_idx on public.chat_rooms (user_a);
create index if not exists chat_rooms_user_b_idx on public.chat_rooms (user_b);

alter table public.chat_rooms enable row level security;
drop policy if exists "own_select" on public.chat_rooms;
drop policy if exists "own_insert" on public.chat_rooms;
drop policy if exists "own_update" on public.chat_rooms;
create policy "own_select" on public.chat_rooms for select using (auth.uid() = user_a or auth.uid() = user_b);
create policy "own_insert" on public.chat_rooms for insert with check (auth.uid() = user_a or auth.uid() = user_b);
create policy "own_update" on public.chat_rooms for update using (auth.uid() = user_a or auth.uid() = user_b) with check (auth.uid() = user_a or auth.uid() = user_b);

-- ---------- chat_messages ----------------------------------------------------
create table if not exists public.chat_messages (
  id          text primary key,
  room_id     text not null,
  sender_id   uuid not null,
  body        text not null,
  created_at  bigint not null,
  edited_at   bigint,
  deleted     boolean default false,
  attachments jsonb default '[]'::jsonb
);
alter table public.chat_messages add column if not exists attachments jsonb default '[]'::jsonb;
create index if not exists chat_messages_room_idx   on public.chat_messages (room_id);
create index if not exists chat_messages_sender_idx on public.chat_messages (sender_id);

alter table public.chat_messages enable row level security;
drop policy if exists "own_select" on public.chat_messages;
drop policy if exists "own_insert" on public.chat_messages;
drop policy if exists "own_update" on public.chat_messages;
drop policy if exists "own_delete" on public.chat_messages;

create policy "own_select" on public.chat_messages for select using (
  exists (select 1 from public.chat_rooms r where r.id = chat_messages.room_id and (r.user_a = auth.uid() or r.user_b = auth.uid()))
);
create policy "own_insert" on public.chat_messages for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from public.chat_rooms r where r.id = chat_messages.room_id and (r.user_a = auth.uid() or r.user_b = auth.uid()))
);
create policy "own_update" on public.chat_messages for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());
create policy "own_delete" on public.chat_messages for delete using (sender_id = auth.uid());

-- ============================================================================
-- Storage — private bucket for chat file/image/video attachments. Objects
-- are uploaded to `<room_id>/<message_id>/<filename>`; RLS scopes read/write
-- to the two participants of that room by parsing the room_id back out of
-- the object path with storage.foldername(). Private (not public) — the
-- client fetches a short-lived signed URL to display/download a file.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists "chat_attachments_select" on storage.objects;
drop policy if exists "chat_attachments_insert" on storage.objects;
drop policy if exists "chat_attachments_delete" on storage.objects;

create policy "chat_attachments_select" on storage.objects for select using (
  bucket_id = 'chat-attachments'
  and exists (
    select 1 from public.chat_rooms r
    where r.id = (storage.foldername(name))[1]
      and (r.user_a = auth.uid() or r.user_b = auth.uid())
  )
);
create policy "chat_attachments_insert" on storage.objects for insert with check (
  bucket_id = 'chat-attachments'
  and exists (
    select 1 from public.chat_rooms r
    where r.id = (storage.foldername(name))[1]
      and (r.user_a = auth.uid() or r.user_b = auth.uid())
  )
);
create policy "chat_attachments_delete" on storage.objects for delete using (
  bucket_id = 'chat-attachments'
  and owner = auth.uid()
);

-- ============================================================================
-- Realtime — enable Postgres Changes push for new messages. Idempotent guard
-- since `alter publication ... add table` errors if run twice.
-- ============================================================================
do $publication_guard$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $publication_guard$;
