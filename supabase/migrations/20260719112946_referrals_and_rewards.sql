-- Referral / rewards system.
-- user_rewards: per-user referral code, one-time bonus AI pool, and a pending-rewards queue the
-- client drains into its Macrodex. referrals: one row per referred user (referee_id PK => once only).
create table if not exists public.user_rewards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code text unique,
  bonus_ai_remaining int not null default 0,
  pending_rewards jsonb not null default '[]'::jsonb,
  referrals_count int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.user_rewards enable row level security;
-- Users may read only their own rewards row. All writes go through SECURITY DEFINER functions
-- invoked by the service role in edge functions, so there are deliberately no write policies.
drop policy if exists "read own rewards" on public.user_rewards;
create policy "read own rewards" on public.user_rewards for select using (auth.uid() = user_id);

create table if not exists public.referrals (
  referee_id uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  code text,
  created_at timestamptz not null default now()
);
alter table public.referrals enable row level security;
drop policy if exists "read own referrals as referrer" on public.referrals;
create policy "read own referrals as referrer" on public.referrals for select using (auth.uid() = referrer_id);
create index if not exists referrals_referrer_idx on public.referrals(referrer_id);

-- Return (creating if needed) the caller's short referral code.
create or replace function public.ensure_referral_code(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  insert into user_rewards(user_id) values (p_user) on conflict (user_id) do nothing;
  select referral_code into c from user_rewards where user_id = p_user;
  if c is not null then return c; end if;
  loop
    c := upper(substr(md5(gen_random_uuid()::text), 1, 7));
    exit when not exists (select 1 from user_rewards where referral_code = c);
  end loop;
  update user_rewards set referral_code = c, updated_at = now() where user_id = p_user;
  return c;
end $$;

-- Atomically award a referral to both sides. Raises unique_violation if the referee was already
-- referred (caller treats that as "already claimed"), or 'self_referral' for a self-claim.
create or replace function public.award_referral(
  p_referee uuid, p_referrer uuid, p_code text,
  p_referee_dino jsonb, p_referrer_dino jsonb, p_bonus int
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_referee = p_referrer then raise exception 'self_referral'; end if;
  insert into referrals(referee_id, referrer_id, code) values (p_referee, p_referrer, p_code);
  insert into user_rewards(user_id) values (p_referee) on conflict (user_id) do nothing;
  insert into user_rewards(user_id) values (p_referrer) on conflict (user_id) do nothing;
  update user_rewards set
    bonus_ai_remaining = bonus_ai_remaining + p_bonus,
    pending_rewards = pending_rewards || p_referee_dino,
    updated_at = now()
  where user_id = p_referee;
  update user_rewards set
    bonus_ai_remaining = bonus_ai_remaining + p_bonus,
    pending_rewards = pending_rewards || p_referrer_dino,
    referrals_count = referrals_count + 1,
    updated_at = now()
  where user_id = p_referrer;
end $$;

-- Consume one call from the one-time bonus pool. Returns the remaining pool, or -1 if empty.
create or replace function public.consume_referral_bonus(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r int;
begin
  update user_rewards set bonus_ai_remaining = greatest(0, bonus_ai_remaining - 1), updated_at = now()
  where user_id = p_user and bonus_ai_remaining > 0
  returning bonus_ai_remaining into r;
  return coalesce(r, -1);
end $$;

-- Remove pending rewards the client has confirmed it merged into the Macrodex.
create or replace function public.ack_pending_rewards(p_user uuid, p_ids text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  update user_rewards set pending_rewards = coalesce((
    select jsonb_agg(e) from jsonb_array_elements(pending_rewards) e where not ((e->>'rid') = any(p_ids))
  ), '[]'::jsonb), updated_at = now()
  where user_id = p_user;
end $$;
