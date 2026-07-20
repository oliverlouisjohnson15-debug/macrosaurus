-- Auto-purge AI logs older than 30 days. Because images are stored inline, a single DELETE
-- removes the row and its images together (no orphaned storage objects).
create extension if not exists pg_cron;

-- cron.schedule with a job name upserts, so re-running this migration is safe.
select cron.schedule(
  'purge_ai_logs',
  '17 3 * * *',   -- daily at 03:17 UTC
  $$delete from public.ai_logs where created_at < now() - interval '30 days'$$
);
