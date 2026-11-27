-- PREMIUM WEEK (reverse trial) and FREE TASTES. See PREMIUM_GROWTH_PLAN.md §1, §2, §5.
--
-- premium_trials: one row per person who has had their free Premium week. Kept apart from
--   `subscriptions` on purpose: the Stripe webhook upserts that row wholesale, and a free week must
--   never be confused with (or overwrite, or be overwritten by) a real subscription.
--   ends_at    while now() < ends_at the person is Premium (ai-proxy and the app both read it).
--   winback_at set once, 30+ days after the week ends, the first time they open the app. Starts a
--              48-hour first-year offer, the same as the 48 hours straight after the week.
--
-- premium_tastes: one free go at a Premium feature, per person, per feature. The first block
--   review, the first week plan in a sentence, the first coverage read, the first deeper dive are
--   the real thing, so the feature sells itself. ai-proxy claims server-gated tastes; the client
--   claims the client-gated one (deepdive) through use_premium_taste().

create table if not exists public.premium_trials (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null,
  winback_at timestamptz
);
alter table public.premium_trials enable row level security;
drop policy if exists "read own premium trial" on public.premium_trials;
create policy "read own premium trial" on public.premium_trials
  for select using ((select auth.uid()) = user_id);

create table if not exists public.premium_tastes (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  used_at timestamptz not null default now(),
  primary key (user_id, feature)
);
alter table public.premium_tastes enable row level security;
drop policy if exists "read own premium tastes" on public.premium_tastes;
create policy "read own premium tastes" on public.premium_tastes
  for select using ((select auth.uid()) = user_id);

-- Start the caller's free Premium week, once ever. Idempotent: a second call returns the existing
-- row. Nobody who is subscribed now, or has ever had a Stripe subscription, gets one (they have
-- seen Premium already). Returns null when not eligible.
create or replace function public.start_premium_week()
returns public.premium_trials
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); r public.premium_trials;
begin
  if uid is null then return null; end if;
  select * into r from premium_trials where user_id = uid;
  if found then return r; end if;
  if exists (select 1 from subscriptions where user_id = uid
             and (status in ('active', 'trialing') or stripe_subscription_id is not null)) then
    return null;
  end if;
  insert into premium_trials (user_id, ends_at) values (uid, now() + interval '7 days')
  on conflict (user_id) do nothing
  returning * into r;
  if not found then select * into r from premium_trials where user_id = uid; end if;
  return r;
end $$;

-- Open the win-back offer: only once, only 30+ days after the week ended, only if still free.
create or replace function public.start_winback()
returns public.premium_trials
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); r public.premium_trials;
begin
  if uid is null then return null; end if;
  if exists (select 1 from subscriptions where user_id = uid and status in ('active', 'trialing')) then
    return null;
  end if;
  update premium_trials set winback_at = now()
   where user_id = uid and winback_at is null and ends_at < now() - interval '30 days'
  returning * into r;
  return r;
end $$;

-- Claim a client-gated taste (only 'deepdive' is client-gated; the rest are claimed by ai-proxy).
-- True if this call claimed it, false if it was already used.
create or replace function public.use_premium_taste(p_feature text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or p_feature not in ('deepdive') then return false; end if;
  insert into premium_tastes (user_id, feature) values (uid, p_feature) on conflict do nothing;
  return found;
end $$;

revoke all on function public.start_premium_week() from public, anon;
revoke all on function public.start_winback() from public, anon;
revoke all on function public.use_premium_taste(text) from public, anon;
grant execute on function public.start_premium_week() to authenticated;
grant execute on function public.start_winback() to authenticated;
grant execute on function public.use_premium_taste(text) to authenticated;
