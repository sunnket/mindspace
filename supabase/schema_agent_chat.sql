-- ============================================================================
-- Mindspace — Agent Chat schema (idempotent, safe to run repeatedly)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor, after schema.sql. Additive/independent
-- of every other table. Adds ONE table: `agent_chat_messages` — the durable,
-- per-canvas conversation between a single user and the AI canvas agent.
--
-- This is a single-owner table (unlike the two-party chat_rooms in
-- schema_chat.sql): every row belongs to exactly one user, so RLS uses the
-- same `auth.uid() = user_id` predicate schema.sql uses for canvas sync.
--
-- Conventions carried over from schema.sql: client-generated `text` primary
-- keys, a `uuid not null` owner column with NO explicit FK to auth.users
-- (the "no FK blocks a write" philosophy), bigint epoch-millis timestamps,
-- `create index if not exists`, and RLS with drop-then-create policies.
--
-- `canvas_id` is a plain text column (canvas ids are client strings like
-- 'root' or a uuid), so one user's history is scoped per board. Deleting a
-- canvas does not cascade here — clearing a thread is an explicit user action.
-- ============================================================================

create table if not exists public.agent_chat_messages (
  id          text primary key,
  user_id     uuid not null,
  canvas_id   text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null default '',
  -- Display-only metadata for file/block attachments shown in a bubble
  -- (name + kind + size). The full extracted text is NOT stored here; it is
  -- only fed to the model at send time.
  attachments jsonb not null default '[]'::jsonb,
  created_at  bigint not null
);

create index if not exists agent_chat_user_canvas_idx
  on public.agent_chat_messages (user_id, canvas_id, created_at);

alter table public.agent_chat_messages enable row level security;

drop policy if exists "agent_chat_select_own" on public.agent_chat_messages;
create policy "agent_chat_select_own" on public.agent_chat_messages
  for select using (auth.uid() = user_id);

drop policy if exists "agent_chat_insert_own" on public.agent_chat_messages;
create policy "agent_chat_insert_own" on public.agent_chat_messages
  for insert with check (auth.uid() = user_id);

drop policy if exists "agent_chat_delete_own" on public.agent_chat_messages;
create policy "agent_chat_delete_own" on public.agent_chat_messages
  for delete using (auth.uid() = user_id);
