create table if not exists public.ai_usage_by_model (
  user_id uuid not null,
  period text not null,
  model text not null,
  spend_usd numeric not null default 0,
  calls int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period, model)
);
alter table public.ai_usage_by_model enable row level security;

create or replace function public.add_ai_usage_model(p_user uuid, p_period text, p_model text, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_usage_by_model (user_id, period, model, spend_usd, calls, updated_at)
  values (p_user, p_period, p_model, p_cost, 1, now())
  on conflict (user_id, period, model)
  do update set spend_usd = public.ai_usage_by_model.spend_usd + excluded.spend_usd,
                calls = public.ai_usage_by_model.calls + 1,
                updated_at = now();
end; $$;
