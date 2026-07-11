-- ============================================================================
-- Mindspace — Agent Memory schema (idempotent, safe to run repeatedly)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor, after schema.sql and schema_chat.sql.
-- Adds: `agent_memory` — a per-user key-value store the canvas agent uses to
-- remember facts, preferences, and instructions across sessions. Memory is
-- scoped to the owning user via RLS; no cross-user leakage is possible.
--
-- The agent writes memories when it detects something worth remembering
-- ("my name is Aryan", "I prefer dark mode", "use Tailwind not raw CSS") and
-- reads them back at the start of every future invocation to build context.
-- ============================================================================

create table if not exists public.agent_memory (
  id            text primary key,
  user_id       uuid not null,
  category      text not null default 'fact',  -- 'preference' | 'fact' | 'instruction' | 'context'
  key           text not null,                 -- short label ("favorite color", "name", "coding style")
  value         text not null,                 -- the actual memory content
  source_prompt text,                          -- the user prompt that triggered this memory
  created_at    bigint not null,
  updated_at    bigint not null
);

create index if not exists agent_memory_user_idx on public.agent_memory (user_id);
create index if not exists agent_memory_category_idx on public.agent_memory (user_id, category);

alter table public.agent_memory enable row level security;

drop policy if exists "own_select" on public.agent_memory;
drop policy if exists "own_insert" on public.agent_memory;
drop policy if exists "own_update" on public.agent_memory;
drop policy if exists "own_delete" on public.agent_memory;

create policy "own_select" on public.agent_memory for select using (auth.uid() = user_id);
create policy "own_insert" on public.agent_memory for insert with check (auth.uid() = user_id);
create policy "own_update" on public.agent_memory for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.agent_memory for delete using (auth.uid() = user_id);
