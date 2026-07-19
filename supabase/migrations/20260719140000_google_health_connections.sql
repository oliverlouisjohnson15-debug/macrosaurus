-- Google Health API account links. One row per user. Holds only what the server needs to keep
-- pulling steps: the rotating OAuth refresh token. The refresh token is sensitive, so this table is
-- service-role-only: RLS is on with NO policies, and direct grants are revoked, so the token is never
-- readable from the client. Only the google-health-proxy edge function (service role) touches it.
create table if not exists public.google_health_connections (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  scope         text,
  connected_at  timestamptz not null default now(),
  last_sync     timestamptz
);

alter table public.google_health_connections enable row level security;
-- Belt and braces: no policies means RLS already denies anon/authenticated; also drop direct grants.
revoke all on public.google_health_connections from anon, authenticated;
