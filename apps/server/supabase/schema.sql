-- Apply in Supabase SQL editor before enabling persistent action logging.
-- Service-role inserts from the server bypass RLS, but user reads should remain scoped.

create extension if not exists pgcrypto;

create table if not exists public.agent_action_threads (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  tool_slug text not null,
  toolkit_slug text null,
  connected_account_id text null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_action_revisions (
  id text primary key,
  action_id text not null references public.agent_action_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  summary text not null,
  arguments jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_action_decisions (
  id uuid primary key default gen_random_uuid(),
  action_id text not null references public.agent_action_threads(id) on delete cascade,
  revision_id text not null references public.agent_action_revisions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  decision text not null,
  source text not null,
  reason text null,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_action_executions (
  id uuid primary key default gen_random_uuid(),
  action_id text not null references public.agent_action_threads(id) on delete cascade,
  revision_id text not null references public.agent_action_revisions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  tool_slug text not null,
  outcome text not null,
  result_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_event_log (
  id uuid primary key default gen_random_uuid(),
  action_id text null references public.agent_action_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_action_threads_user_created
  on public.agent_action_threads (user_id, created_at desc);
create index if not exists idx_agent_action_revisions_action_created
  on public.agent_action_revisions (action_id, created_at desc);
create index if not exists idx_agent_action_decisions_action_created
  on public.agent_action_decisions (action_id, created_at desc);
create index if not exists idx_agent_action_executions_action_created
  on public.agent_action_executions (action_id, created_at desc);
create index if not exists idx_agent_event_log_user_created
  on public.agent_event_log (user_id, created_at desc);

alter table public.agent_action_threads enable row level security;
alter table public.agent_action_revisions enable row level security;
alter table public.agent_action_decisions enable row level security;
alter table public.agent_action_executions enable row level security;
alter table public.agent_event_log enable row level security;

drop policy if exists "agent_action_threads_select_own" on public.agent_action_threads;
create policy "agent_action_threads_select_own"
  on public.agent_action_threads
  for select
  using (auth.uid() = user_id);

drop policy if exists "agent_action_revisions_select_own" on public.agent_action_revisions;
create policy "agent_action_revisions_select_own"
  on public.agent_action_revisions
  for select
  using (auth.uid() = user_id);

drop policy if exists "agent_action_decisions_select_own" on public.agent_action_decisions;
create policy "agent_action_decisions_select_own"
  on public.agent_action_decisions
  for select
  using (auth.uid() = user_id);

drop policy if exists "agent_action_executions_select_own" on public.agent_action_executions;
create policy "agent_action_executions_select_own"
  on public.agent_action_executions
  for select
  using (auth.uid() = user_id);

drop policy if exists "agent_event_log_select_own" on public.agent_event_log;
create policy "agent_event_log_select_own"
  on public.agent_event_log
  for select
  using (auth.uid() = user_id);
