-- Enable required extensions
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Schedule composio-sync Edge Function every 5 minutes
select cron.schedule(
  'composio-sync-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://sdenwwznmazdzcelrqfe.supabase.co/functions/v1/composio-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkZW53d3pubWF6ZHpjZWxycWZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNzk2NCwiZXhwIjoyMDg3OTAzOTY0fQ.Ltw1SWYiqF_6pmrnjbTl-eKZPiNmGzbB9gjKFXuyAYo"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
