-- Single-row global config (currently just the default monthly AI cap).
create table if not exists public.app_config (
  id int primary key default 1,
  default_cap_usd numeric(12,4) not null default 1.00,
  updated_at timestamptz not null default now(),
  constraint app_config_singleton check (id = 1)
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;
alter table public.app_config enable row level security;
-- no client policies: only edge functions (service role) read/write config

-- Free-text support notes an admin can leave on a user account.
create table if not exists public.support_notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  note text not null,
  created_at timestamptz not null default now()
);
alter table public.support_notes enable row level security;
create index if not exists support_notes_user_idx on public.support_notes (user_id, created_at desc);
-- no client policies: only the admin edge function (service role) reads/writes notes
