create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,
  spend_usd numeric(12,6) not null default 0,
  calls integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period)
);

alter table public.ai_usage enable row level security;

-- Users may read their own usage (e.g. to show remaining budget). No client writes: only the
-- edge function (service role / SECURITY DEFINER rpc) records spend.
drop policy if exists "read own ai usage" on public.ai_usage;
create policy "read own ai usage" on public.ai_usage
  for select using (auth.uid() = user_id);

-- Atomic upsert-increment so concurrent AI calls can't clobber each other's spend.
create or replace function public.add_ai_usage(p_user uuid, p_period text, p_cost numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total numeric;
begin
  insert into public.ai_usage (user_id, period, spend_usd, calls, updated_at)
  values (p_user, p_period, p_cost, 1, now())
  on conflict (user_id, period)
  do update set spend_usd = public.ai_usage.spend_usd + excluded.spend_usd,
                calls = public.ai_usage.calls + 1,
                updated_at = now()
  returning spend_usd into new_total;
  return new_total;
end;
$$;

revoke all on function public.add_ai_usage(uuid, text, numeric) from public, anon, authenticated;
