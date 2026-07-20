create table if not exists public.google_health_connections (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  scope         text,
  connected_at  timestamptz not null default now(),
  last_sync     timestamptz
);

alter table public.google_health_connections enable row level security;
revoke all on public.google_health_connections from anon, authenticated;
