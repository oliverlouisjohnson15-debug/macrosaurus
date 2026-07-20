-- Who may access the admin panel. A user can read ONLY their own row (so the app can decide
-- whether to show the admin UI); listing/among others is never exposed to the client.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "self can read own admin row" on public.admins;
create policy "self can read own admin row" on public.admins
  for select using (auth.uid() = user_id);

-- Per-user monthly AI spend cap. Absent row => global default is used by the proxy.
create table if not exists public.user_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_cap_usd numeric(12,4) not null default 1.00,
  updated_at timestamptz not null default now()
);
alter table public.user_limits enable row level security;
-- no client policies: only edge functions (service role) touch caps

-- Audit trail of every admin action (viewing personal health data included).
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id),
  action text not null,
  target_user_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
-- no client policies: readable only via the admin edge function (service role)
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

-- Seed the owner as the first admin.
insert into public.admins (user_id)
select id from auth.users where lower(email) = 'oliverlouisjohnson15@gmail.com'
on conflict (user_id) do nothing;
