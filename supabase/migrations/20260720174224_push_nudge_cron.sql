-- Fire the push-nudge sender every hour on the hour. The function itself filters to users whose
-- LOCAL hour matches their nudge_hour, so an hourly tick covers every timezone. The cron secret is
-- read from app_secrets (never hard-coded here); the function rejects any call without it.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'push_nudge_hourly',
  '0 * * * *',
  $$
    select net.http_post(
      url := 'https://wnbksotvcjqfslrttjxy.supabase.co/functions/v1/push-nudge',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_secrets where key = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
