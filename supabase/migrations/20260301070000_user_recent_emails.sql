-- Cache of recent emails per user, populated by the composio sync cron.
create table public.user_recent_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  thread_id text,
  from_address text not null default '',
  to_address text not null default '',
  subject text not null default '',
  snippet text not null default '',
  received_at timestamptz,
  label_ids text[] not null default '{}',
  synced_at timestamptz not null default now(),
  unique(user_id, message_id)
);

create index idx_user_recent_emails_user on public.user_recent_emails(user_id);
create index idx_user_recent_emails_received on public.user_recent_emails(user_id, received_at desc);

alter table public.user_recent_emails enable row level security;

create policy "emails_select_own" on public.user_recent_emails
  for select using (auth.uid() = user_id);
