-- Slack messages cache
create table public.user_recent_slack_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_ts text not null,
  channel_id text not null,
  channel_name text not null default '',
  sender_name text not null default '',
  sender_id text not null default '',
  message_text text not null default '',
  received_at timestamptz,
  synced_at timestamptz not null default now(),
  unique(user_id, channel_id, message_ts)
);
create index idx_user_slack_msgs_user on public.user_recent_slack_messages(user_id);
alter table public.user_recent_slack_messages enable row level security;
create policy "slack_select_own" on public.user_recent_slack_messages
  for select using (auth.uid() = user_id);

-- Pre-prepared calendar events for demo
create table public.user_demo_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  linked_message_id text,
  event_name text not null default '',
  event_description text not null default '',
  start_time timestamptz,
  end_time timestamptz,
  attendee_email text,
  calendly_link text,
  created_at timestamptz not null default now(),
  unique(user_id, linked_message_id)
);
create index idx_user_demo_cal_user on public.user_demo_calendar_events(user_id);
alter table public.user_demo_calendar_events enable row level security;
create policy "cal_select_own" on public.user_demo_calendar_events
  for select using (auth.uid() = user_id);
