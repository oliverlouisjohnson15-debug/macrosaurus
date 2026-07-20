create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

drop policy if exists "own_state_select" on public.user_state;
drop policy if exists "own_state_insert" on public.user_state;
drop policy if exists "own_state_update" on public.user_state;

create policy "own_state_select" on public.user_state
  for select using (auth.uid() = user_id);
create policy "own_state_insert" on public.user_state
  for insert with check (auth.uid() = user_id);
create policy "own_state_update" on public.user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
