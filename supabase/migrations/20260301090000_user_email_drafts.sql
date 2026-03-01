create table public.user_email_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  thread_id text,
  subject text not null default '',
  draft_body text not null default '',
  created_at timestamptz not null default now(),
  unique(user_id, message_id)
);
create index idx_user_email_drafts_user on public.user_email_drafts(user_id);
alter table public.user_email_drafts enable row level security;
create policy "drafts_select_own" on public.user_email_drafts
  for select using (auth.uid() = user_id);
