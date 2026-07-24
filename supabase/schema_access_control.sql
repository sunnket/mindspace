-- ============================================================================
-- Private-invite access control — "nobody gets in without the owner's say-so"
-- ----------------------------------------------------------------------------
-- Run this ONCE in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- >>> BEFORE YOU RUN IT: set your own address on the OWNER EMAIL line below. <<<
--
-- Three independent locks, so no single bypass opens the door:
--
--   1. HARD LOCK  — a BEFORE INSERT trigger on auth.users. An account simply
--                   cannot be created unless its email is already on the
--                   allowlist. This catches raw `curl` calls straight at
--                   /auth/v1/signup with the public anon key, which a UI-only
--                   check never could.
--   2. DATA LOCK  — every RLS policy on every user table now also requires
--                   public.is_approved(). Even if an account somehow exists,
--                   it reads and writes exactly nothing: no canvases, no
--                   objects, no chat, no storage. This is the real lock —
--                   Postgres enforces it no matter what the client does.
--   3. UI LOCK    — the app asks the DB before showing the sign-up form, and
--                   parks unapproved sessions on a "waiting for approval"
--                   screen. Convenience only; 1 and 2 are the security.
--
-- Two ways in, both under your control:
--   * ACCESS KEY  — you mint a key and hand it to someone. They type it on the
--                   sign-up form, which allowlists their email and lets them
--                   through. (This is the "tell them the password" idea, but
--                   per-person, expiring, revocable and countable instead of
--                   one shared secret that leaks once and leaks forever.)
--   * REQUEST     — they leave their email + a note. It lands in a queue you
--                   approve or deny at /admin. Approving allowlists them.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. The allowlist — the single source of truth for "who is allowed"
-- ============================================================================
create table if not exists public.allowlist (
  email     text primary key,
  role      text not null default 'member',   -- 'owner' | 'member'
  note      text,
  added_at  timestamptz not null default now()
);

-- Emails are compared exactly, so they must be stored in one canonical shape.
-- A trigger (not a convention) so rows typed by hand into the Supabase table
-- editor can't quietly create an entry that never matches.
create or replace function public.normalize_allowlist_email()
returns trigger language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;

drop trigger if exists normalize_allowlist_email on public.allowlist;
create trigger normalize_allowlist_email
  before insert or update on public.allowlist
  for each row execute function public.normalize_allowlist_email();

-- ---------------------------------------------------------------------------
-- >>> OWNER EMAIL — change this to yours. This account can never be locked
-- >>> out by the rules below, and is the only one that sees /admin.
-- ---------------------------------------------------------------------------
insert into public.allowlist (email, role, note)
values ('sanketsharma1403@gmail.com', 'owner', 'Owner — do not delete this row')
on conflict (email) do update set role = 'owner';

-- ---------------------------------------------------------------------------
-- Already have accounts you want to keep? Uncomment to grandfather in
-- EVERYONE who has signed up so far. Look before you leap:
--     select email, created_at from auth.users order by created_at;
-- ---------------------------------------------------------------------------
-- insert into public.allowlist (email, role, note)
--   select lower(email), 'member', 'grandfathered ' || now()::date
--   from auth.users where email is not null
--   on conflict (email) do nothing;

-- ============================================================================
-- 2. Identity helpers
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER on purpose: these run as the function owner, so they can
-- read the allowlist even though the caller can't. That is also why calling
-- them from allowlist's own RLS policy is not infinite recursion — the inner
-- read never re-enters policy evaluation.
-- ============================================================================
create or replace function public.current_email()
returns text language sql stable security definer set search_path = public, auth as $$
  select lower(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select u.email from auth.users u where u.id = auth.uid())
  ))
$$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.allowlist a where a.email = public.current_email())
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.allowlist a
    where a.email = public.current_email() and a.role = 'owner'
  )
$$;

grant execute on function public.current_email() to anon, authenticated;
grant execute on function public.is_approved()  to anon, authenticated;
grant execute on function public.is_owner()     to anon, authenticated;

-- ============================================================================
-- 3. Access keys — the invite you hand out
-- ============================================================================
create table if not exists public.access_keys (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,        -- normalized: A-Z0-9, no separators
  label        text,                        -- who it's for, in your words
  email        text,                        -- optional: lock the key to one address
  max_uses     int  not null default 1,
  uses         int  not null default 0,
  expires_at   timestamptz,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- Every attempt is recorded — both to throttle guessing and so a burst of
-- failures is visible to you instead of silent.
create table if not exists public.access_key_attempts (
  id      bigserial primary key,
  email   text,
  ok      boolean not null,
  at      timestamptz not null default now()
);
create index if not exists access_key_attempts_at_idx on public.access_key_attempts (at desc);

-- ============================================================================
-- 4. Access requests — the queue you approve from
-- ============================================================================
create table if not exists public.access_requests (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  name        text,
  reason      text,
  status      text not null default 'pending',   -- pending | approved | denied
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create unique index if not exists access_requests_one_pending
  on public.access_requests (email) where status = 'pending';

-- ============================================================================
-- 5. RLS — these three tables are yours alone.
--    No policy grants anyone else a row; the public paths below are all
--    SECURITY DEFINER functions with a narrow, fixed job.
-- ============================================================================
alter table public.allowlist            enable row level security;
alter table public.access_keys          enable row level security;
alter table public.access_key_attempts  enable row level security;
alter table public.access_requests      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['allowlist','access_keys','access_key_attempts','access_requests']
  loop
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('create policy "owner_all" on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
    -- Belt and braces: the anon role has no business touching these at all.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ============================================================================
-- 6. Public entry points (the only doors anon can knock on)
-- ============================================================================

create or replace function public.normalize_access_key(p_key text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_key, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

-- Does this address already have permission? Used by the sign-up form so an
-- approved person isn't asked for a key they were never given. It reveals only
-- whether an address you already typed is invited — never a list.
create or replace function public.check_signup_access(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.allowlist a where a.email = lower(trim(p_email))) then 'allowed'
    when exists (select 1 from public.access_requests r
                 where r.email = lower(trim(p_email)) and r.status = 'pending') then 'pending'
    else 'blocked'
  end
$$;

-- Redeem a key: allowlists the caller's email so sign-up can proceed.
create or replace function public.redeem_access_key(p_key text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_code  text := public.normalize_access_key(p_key);
  v_key   public.access_keys%rowtype;
  v_fails int;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'That email address does not look right.');
  end if;

  -- 60-bit keys make guessing hopeless on its own; this mostly keeps a
  -- misfiring client from filling the attempts table.
  select count(*) into v_fails from public.access_key_attempts
   where email = v_email and not ok and at > now() - interval '15 minutes';
  if v_fails >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many tries. Wait 15 minutes and try again.');
  end if;

  select * into v_key from public.access_keys
   where code = v_code
     and not revoked
     and (expires_at is null or expires_at > now())
     and uses < max_uses
     and (email is null or email = v_email)
   limit 1;

  if not found then
    insert into public.access_key_attempts (email, ok) values (v_email, false);
    return jsonb_build_object('ok', false, 'error', 'That access key is not valid, has expired, or has already been used.');
  end if;

  insert into public.allowlist (email, role, note)
  values (v_email, 'member', coalesce('key: ' || v_key.label, 'access key'))
  on conflict (email) do nothing;

  update public.access_keys
     set uses = uses + 1, last_used_at = now()
   where id = v_key.id;

  update public.access_requests
     set status = 'approved', decided_at = now()
   where email = v_email and status = 'pending';

  insert into public.access_key_attempts (email, ok) values (v_email, true);
  return jsonb_build_object('ok', true);
end $$;

-- Leave a request for the owner to approve.
create or replace function public.request_access(
  p_email text, p_name text default null, p_reason text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_recent int;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right.';
  end if;

  if exists (select 1 from public.allowlist a where a.email = v_email) then
    return 'approved';
  end if;
  if exists (select 1 from public.access_requests r where r.email = v_email and r.status = 'pending') then
    return 'pending';
  end if;

  -- Caps how fast the queue can be flooded. Worst case a spammer stops other
  -- people requesting for an hour; they still can't get in, and you can clear
  -- the table. The alternative — an unbounded public insert — is worse.
  select count(*) into v_recent from public.access_requests where created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception 'Too many requests right now. Please try again later.';
  end if;

  insert into public.access_requests (email, name, reason)
  values (v_email, nullif(trim(coalesce(p_name, '')), ''), left(nullif(trim(coalesce(p_reason, '')), ''), 500));
  return 'pending';
end $$;

-- Where do I stand? Drives the "waiting for approval" screen.
create or replace function public.my_access_status()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'anon'
    when public.is_owner() then 'owner'
    when public.is_approved() then 'approved'
    when exists (select 1 from public.access_requests r
                 where r.email = public.current_email() and r.status = 'pending') then 'pending'
    else 'blocked'
  end
$$;

grant execute on function public.check_signup_access(text)       to anon, authenticated;
grant execute on function public.redeem_access_key(text, text)   to anon, authenticated;
grant execute on function public.request_access(text, text, text) to anon, authenticated;
grant execute on function public.my_access_status()              to anon, authenticated;

-- ============================================================================
-- 7. Owner-only operations (the /admin page)
-- ============================================================================

-- Crockford-ish alphabet: no I, O, 0 or 1, so a key read aloud or copied off a
-- screen can't be mistyped into a different valid key. 12 chars ≈ 60 bits.
create or replace function public.admin_create_access_key(
  p_label text default null,
  p_email text default null,
  p_max_uses int default 1,
  p_days int default 14
) returns text language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(12);
  code text := '';
  i int;
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;

  for i in 0..11 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
  end loop;

  insert into public.access_keys (code, label, email, max_uses, expires_at)
  values (
    code,
    nullif(trim(coalesce(p_label, '')), ''),
    lower(nullif(trim(coalesce(p_email, '')), '')),
    greatest(1, coalesce(p_max_uses, 1)),
    case when p_days is null or p_days <= 0 then null else now() + make_interval(days => p_days) end
  );

  -- Grouped for reading out loud; redemption strips the dashes.
  return substr(code, 1, 4) || '-' || substr(code, 5, 4) || '-' || substr(code, 9, 4);
end $$;

create or replace function public.admin_approve_request(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;

  update public.access_requests
     set status = 'approved', decided_at = now()
   where id = p_id
  returning email into v_email;

  if v_email is null then raise exception 'no_such_request'; end if;

  insert into public.allowlist (email, role, note)
  values (v_email, 'member', 'approved ' || now()::date)
  on conflict (email) do nothing;

  return v_email;
end $$;

create or replace function public.admin_deny_request(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;
  update public.access_requests set status = 'denied', decided_at = now() where id = p_id;
  return 'ok';
end $$;

-- Removing the allowlist row is what actually cuts them off — RLS stops
-- answering for them the moment it's gone. Deleting the account on top is
-- optional and only kills the lingering session; their canvas rows stay in the
-- tables, orphaned and unreadable by anyone (there are deliberately no FKs to
-- auth.users). To clear those out too:
--     delete from public.canvases where user_id = '<uuid>';   -- etc.
create or replace function public.admin_revoke_member(p_email text, p_delete_account boolean default true)
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;
  if exists (select 1 from public.allowlist a where a.email = v_email and a.role = 'owner') then
    raise exception 'cannot_revoke_owner';
  end if;

  delete from public.allowlist where email = v_email;
  update public.access_requests set status = 'denied', decided_at = now()
   where email = v_email and status = 'pending';

  if p_delete_account then
    -- Best-effort: auth.users belongs to supabase_auth_admin, so this can be
    -- refused depending on how the project is set up. Losing the account
    -- deletion must not lose the revoke, which is the part that matters.
    begin
      delete from auth.users where lower(email) = v_email;
    exception when others then
      null;
    end;
  end if;

  return 'ok';
end $$;

create or replace function public.admin_revoke_key(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;
  update public.access_keys set revoked = true where id = p_id;
  return 'ok';
end $$;

grant execute on function public.admin_create_access_key(text, text, int, int) to authenticated;
grant execute on function public.admin_approve_request(uuid)                   to authenticated;
grant execute on function public.admin_deny_request(uuid)                      to authenticated;
grant execute on function public.admin_revoke_member(text, boolean)            to authenticated;
grant execute on function public.admin_revoke_key(uuid)                        to authenticated;

-- ============================================================================
-- 8. HARD LOCK — no allowlist entry, no account. Full stop.
-- ----------------------------------------------------------------------------
-- This is what makes the gate real rather than cosmetic: the anon key is
-- public by design, so anyone can POST to /auth/v1/signup directly. With this
-- trigger that request fails inside Postgres before a user row exists.
--
-- Consequence to remember: inviting someone from the Supabase dashboard fails
-- too, unless you add their email to public.allowlist first. That is the
-- intended behaviour — one list, no side doors.
--
-- To lift it temporarily:
--     drop trigger if exists enforce_signup_allowlist on auth.users;
-- ============================================================================
create or replace function public.enforce_signup_allowlist()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare v_email text := lower(trim(coalesce(new.email, '')));
begin
  if v_email <> '' and exists (select 1 from public.allowlist a where a.email = v_email) then
    return new;
  end if;
  raise exception 'This email has not been approved for canvabrains.'
    using errcode = '42501',
          hint = 'Request access on the sign-in page, or ask the owner for an access key.';
end $$;

drop trigger if exists enforce_signup_allowlist on auth.users;
create trigger enforce_signup_allowlist
  before insert on auth.users
  for each row execute function public.enforce_signup_allowlist();

-- ============================================================================
-- 9. DATA LOCK — re-issue every policy with the approval check folded in.
-- ----------------------------------------------------------------------------
-- Ownership (auth.uid() = user_id) still applies exactly as before; approval
-- is an additional condition, never a replacement. An unapproved session sees
-- an empty database and every write is rejected.
-- ============================================================================

-- ---------- core canvas tables ----------
do $$
declare t text;
begin
  foreach t in array array['canvases','canvas_objects','drawing_strokes','connections']
  loop
    execute format('drop policy if exists "own_select" on public.%I', t);
    execute format('drop policy if exists "own_insert" on public.%I', t);
    execute format('drop policy if exists "own_update" on public.%I', t);
    execute format('drop policy if exists "own_delete" on public.%I', t);

    execute format('create policy "own_select" on public.%I for select using (auth.uid() = user_id and public.is_approved())', t);
    execute format('create policy "own_insert" on public.%I for insert with check (auth.uid() = user_id and public.is_approved())', t);
    execute format('create policy "own_update" on public.%I for update using (auth.uid() = user_id and public.is_approved()) with check (auth.uid() = user_id and public.is_approved())', t);
    execute format('create policy "own_delete" on public.%I for delete using (auth.uid() = user_id and public.is_approved())', t);
  end loop;
end $$;

-- ---------- profiles (only re-secured if schema_chat.sql has been run) ------
do $$
begin
  if to_regclass('public.profiles') is not null then
    drop policy if exists "profiles_select_any" on public.profiles;
    drop policy if exists "profiles_insert_own" on public.profiles;
    drop policy if exists "profiles_update_own" on public.profiles;
    create policy "profiles_select_any" on public.profiles for select using (auth.uid() is not null and public.is_approved());
    create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id and public.is_approved());
    create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id and public.is_approved()) with check (auth.uid() = id and public.is_approved());
  end if;

  if to_regclass('public.chat_rooms') is not null then
    drop policy if exists "own_select" on public.chat_rooms;
    drop policy if exists "own_insert" on public.chat_rooms;
    drop policy if exists "own_update" on public.chat_rooms;
    create policy "own_select" on public.chat_rooms for select using ((auth.uid() = user_a or auth.uid() = user_b) and public.is_approved());
    create policy "own_insert" on public.chat_rooms for insert with check ((auth.uid() = user_a or auth.uid() = user_b) and public.is_approved());
    create policy "own_update" on public.chat_rooms for update using ((auth.uid() = user_a or auth.uid() = user_b) and public.is_approved()) with check ((auth.uid() = user_a or auth.uid() = user_b) and public.is_approved());
  end if;

  if to_regclass('public.chat_messages') is not null then
    drop policy if exists "own_select" on public.chat_messages;
    drop policy if exists "own_insert" on public.chat_messages;
    drop policy if exists "own_update" on public.chat_messages;
    drop policy if exists "own_delete" on public.chat_messages;
    create policy "own_select" on public.chat_messages for select using (
      public.is_approved() and exists (
        select 1 from public.chat_rooms r
        where r.id = chat_messages.room_id and (r.user_a = auth.uid() or r.user_b = auth.uid()))
    );
    create policy "own_insert" on public.chat_messages for insert with check (
      public.is_approved() and sender_id = auth.uid() and exists (
        select 1 from public.chat_rooms r
        where r.id = chat_messages.room_id and (r.user_a = auth.uid() or r.user_b = auth.uid()))
    );
    create policy "own_update" on public.chat_messages for update using (sender_id = auth.uid() and public.is_approved()) with check (sender_id = auth.uid() and public.is_approved());
    create policy "own_delete" on public.chat_messages for delete using (sender_id = auth.uid() and public.is_approved());
  end if;

  if to_regclass('public.agent_chat_messages') is not null then
    drop policy if exists "agent_chat_select_own" on public.agent_chat_messages;
    drop policy if exists "agent_chat_insert_own" on public.agent_chat_messages;
    drop policy if exists "agent_chat_delete_own" on public.agent_chat_messages;
    create policy "agent_chat_select_own" on public.agent_chat_messages for select using (auth.uid() = user_id and public.is_approved());
    create policy "agent_chat_insert_own" on public.agent_chat_messages for insert with check (auth.uid() = user_id and public.is_approved());
    create policy "agent_chat_delete_own" on public.agent_chat_messages for delete using (auth.uid() = user_id and public.is_approved());
  end if;

  -- Share links stay public on purpose: /s/<token> reads through the
  -- SECURITY DEFINER get_shared_board(), which never touches these policies.
  -- Only the owner-side management of shares is gated.
  if to_regclass('public.shares') is not null then
    drop policy if exists "shares_own_select" on public.shares;
    drop policy if exists "shares_own_insert" on public.shares;
    drop policy if exists "shares_own_update" on public.shares;
    drop policy if exists "shares_own_delete" on public.shares;
    create policy "shares_own_select" on public.shares for select using (auth.uid() = user_id and public.is_approved());
    create policy "shares_own_insert" on public.shares for insert with check (auth.uid() = user_id and public.is_approved());
    create policy "shares_own_update" on public.shares for update using (auth.uid() = user_id and public.is_approved()) with check (auth.uid() = user_id and public.is_approved());
    create policy "shares_own_delete" on public.shares for delete using (auth.uid() = user_id and public.is_approved());
  end if;
end $$;

-- ---------- agent_memory (column name differs by install) -------------------
do $$
declare
  has_user_id boolean;
begin
  if to_regclass('public.agent_memory') is null then return; end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_memory' and column_name = 'user_id'
  ) into has_user_id;

  if has_user_id then
    drop policy if exists "own_select" on public.agent_memory;
    drop policy if exists "own_insert" on public.agent_memory;
    drop policy if exists "own_update" on public.agent_memory;
    drop policy if exists "own_delete" on public.agent_memory;
    create policy "own_select" on public.agent_memory for select using (auth.uid() = user_id and public.is_approved());
    create policy "own_insert" on public.agent_memory for insert with check (auth.uid() = user_id and public.is_approved());
    create policy "own_update" on public.agent_memory for update using (auth.uid() = user_id and public.is_approved()) with check (auth.uid() = user_id and public.is_approved());
    create policy "own_delete" on public.agent_memory for delete using (auth.uid() = user_id and public.is_approved());
  end if;
end $$;

-- ---------- storage: chat attachments ---------------------------------------
do $$
begin
  if to_regclass('public.chat_rooms') is null then return; end if;

  drop policy if exists "chat_attachments_select" on storage.objects;
  drop policy if exists "chat_attachments_insert" on storage.objects;
  drop policy if exists "chat_attachments_delete" on storage.objects;

  create policy "chat_attachments_select" on storage.objects for select using (
    bucket_id = 'chat-attachments' and public.is_approved() and exists (
      select 1 from public.chat_rooms r
      where r.id = (storage.foldername(name))[1] and (r.user_a = auth.uid() or r.user_b = auth.uid()))
  );
  create policy "chat_attachments_insert" on storage.objects for insert with check (
    bucket_id = 'chat-attachments' and public.is_approved() and exists (
      select 1 from public.chat_rooms r
      where r.id = (storage.foldername(name))[1] and (r.user_a = auth.uid() or r.user_b = auth.uid()))
  );
  create policy "chat_attachments_delete" on storage.objects for delete using (
    bucket_id = 'chat-attachments' and owner = auth.uid() and public.is_approved()
  );
end $$;

-- ============================================================================
-- Done. Sanity checks:
--   select public.my_access_status();                    -- as yourself: 'owner'
--   select * from public.allowlist;                      -- who can get in
--   select public.admin_create_access_key('a friend');   -- mint an invite
--
-- And the one that matters — anything still reachable without approval? This
-- should return only the four access-control tables. Re-run it whenever you
-- add a table, because a new table with a plain own_* policy is a new door:
--
--   select tablename, policyname from pg_policies
--    where schemaname = 'public'
--      and coalesce(qual, '') || coalesce(with_check, '') not like '%is_approved%'
--    order by tablename;
-- ============================================================================
