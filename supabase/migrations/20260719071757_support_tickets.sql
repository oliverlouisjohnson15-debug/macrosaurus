-- User-submitted support tickets / feature requests.
-- Users can see only their own rows (for in-app status + reply tracking). All writes go
-- through the `support` (submit) and `admin-support` (triage) edge functions using the
-- service role, which bypasses RLS, so there are deliberately no client write policies.
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text,
  kind text not null check (kind in ('bug','feature','question')),
  body text not null check (char_length(body) between 1 and 4000),
  status text not null default 'received' check (status in ('received','in_review','resolved')),
  admin_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_status_created_idx
  on public.support_tickets (status, created_at desc);
create index if not exists support_tickets_user_created_idx
  on public.support_tickets (user_id, created_at desc);

alter table public.support_tickets enable row level security;

drop policy if exists support_tickets_select_own on public.support_tickets;
create policy support_tickets_select_own on public.support_tickets
  for select using (auth.uid() = user_id);
