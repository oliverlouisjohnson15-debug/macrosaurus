-- Server-only key/value secrets read by edge functions via the service role (which is auto-injected
-- into the Deno runtime). RLS is enabled with NO policies on purpose: anon/authenticated get nothing,
-- service_role bypasses RLS. Same deny-all pattern as ai_logs / google_health_connections. Holds the
-- VAPID private key and the push-nudge cron shared secret; values are inserted out-of-band, never in
-- a committed migration.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
-- Intentionally no policies: service-role bypasses RLS; everyone else is denied.
comment on table public.app_secrets is 'Server-only secrets (VAPID private key, cron secret). Deny-all RLS; read only by edge functions as service_role.';
