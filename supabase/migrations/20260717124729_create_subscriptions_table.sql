-- Per-user subscription state. Written only by the Stripe webhook (service_role);
-- the client can read its own row to gate premium features.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'free',        -- free | trialing | active | past_due | canceled | incomplete
  plan text,                                  -- monthly | annual
  price_id text,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Users may read only their own subscription row. No client write policy:
-- all writes come from the Stripe webhook running as service_role, which bypasses RLS.
create policy "own_subscription_select" on public.subscriptions
  for select using ((select auth.uid()) = user_id);

-- Fast lookups for the webhook (unique constraints already index the stripe ids).
create index if not exists subscriptions_status_idx on public.subscriptions (status);
