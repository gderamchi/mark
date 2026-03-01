-- Connexions Composio par utilisateur (quels plugins sont branchés)
create table public.user_composio_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  composio_user_id text not null,
  connected_account_id text not null,
  toolkit_slug text not null,
  toolkit_name text not null,
  status text not null default 'ACTIVE',
  auth_scheme text,
  synced_at timestamptz not null default now(),
  unique(user_id, connected_account_id)
);

-- Outils disponibles par utilisateur (cache des tools Composio)
create table public.user_composio_tools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  tool_slug text not null,
  toolkit_slug text not null,
  description text not null,
  input_schema jsonb not null default '{}'::jsonb,
  is_mutating boolean not null default true,
  synced_at timestamptz not null default now(),
  unique(user_id, tool_slug)
);

-- Index pour lecture rapide
create index idx_user_composio_connections_user on public.user_composio_connections(user_id);
create index idx_user_composio_tools_user on public.user_composio_tools(user_id);
create index idx_user_composio_tools_toolkit on public.user_composio_tools(user_id, toolkit_slug);

-- RLS
alter table public.user_composio_connections enable row level security;
alter table public.user_composio_tools enable row level security;

create policy "connections_select_own" on public.user_composio_connections
  for select using (auth.uid() = user_id);
create policy "tools_select_own" on public.user_composio_tools
  for select using (auth.uid() = user_id);
