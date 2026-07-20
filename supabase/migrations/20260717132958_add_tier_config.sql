-- Tiering config on the single-row app_config. enforce_tiers stays FALSE until the paywall ships,
-- so existing beta users keep the current behaviour (legacy USD cap) with zero disruption.
alter table public.app_config
  add column if not exists free_ai_monthly integer not null default 10,
  add column if not exists premium_cap_usd numeric not null default 3.00,
  add column if not exists enforce_tiers boolean not null default false;

-- Let signed-in users read the (non-sensitive) tier config so the app can show
-- "N free AI logs left" and whether tiering is live. app_config holds only caps/flags.
drop policy if exists config_read on public.app_config;
create policy config_read on public.app_config for select to authenticated using (true);
