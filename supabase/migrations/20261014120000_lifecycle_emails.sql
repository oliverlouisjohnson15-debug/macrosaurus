-- Lifecycle email: at most two personal emails to people who signed up and then barely used the app
-- (an early "log one meal" nudge, then a one-question "what got in the way?"). Sent by the `lifecycle-email` edge function, daily via
-- pg_cron, through the same Resend account the support function uses.
--
-- Two server-only tables (deny-all RLS, same pattern as app_secrets / ai_logs):
--   lifecycle_emails - one row per (user, kind) ever sent. The primary key IS the dedupe: the
--                      function claims the row before sending, so a user can never get the same
--                      email twice, even if two runs overlap.
--   email_optouts    - anyone who clicked unsubscribe. Checked before every send, forever.

create table if not exists public.lifecycle_emails (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  variant text,
  sent_at timestamptz not null default now(),
  resend_id text,
  primary key (user_id, kind)
);
alter table public.lifecycle_emails enable row level security;
-- Intentionally no policies: service_role bypasses RLS; everyone else is denied.

create table if not exists public.email_optouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.email_optouts enable row level security;
-- Intentionally no policies.

-- Everything the edge function needs to decide who to email, in one pass, without shipping whole
-- user_state blobs over the wire. Only users who signed up between p_min_days and p_max_days ago,
-- have a confirmed email, have not opted out, and have not already had p_kind. Activity is the same
-- definition the push ladder uses (food logged, weighed, or trained), reduced to a count of distinct
-- active days and the latest one. Server-only: it reads auth.users and every user's state.
create or replace function public.lifecycle_candidates(p_kind text, p_min_days int, p_max_days int)
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  has_profile boolean,
  buddy_name text,
  active_days int,
  last_active text,
  has_ticket boolean
)
language sql
security definer
set search_path = public, auth
as $$
  with base as (
    select u.id, u.email, u.created_at, s.data
    from auth.users u
    left join public.user_state s on s.user_id = u.id
    where u.email is not null
      and u.email_confirmed_at is not null
      and u.created_at <= now() - make_interval(days => p_min_days)
      and u.created_at >  now() - make_interval(days => p_max_days)
      and not exists (select 1 from public.email_optouts o where o.user_id = u.id)
      and not exists (select 1 from public.lifecycle_emails l where l.user_id = u.id and l.kind = p_kind)
  ),
  arr as (
    select b.id,
      case when jsonb_typeof(b.data->'log_entries') = 'array' then b.data->'log_entries' else '[]'::jsonb end as logs,
      case when jsonb_typeof(b.data->'weight_entries') = 'array' then b.data->'weight_entries' else '[]'::jsonb end as weights,
      case when jsonb_typeof(b.data->'training'->'logs') = 'array' then b.data->'training'->'logs' else '[]'::jsonb end as sessions
    from base b
  ),
  days as (
    select a.id, d.day
    from arr a
    cross join lateral (
      select e->>'date' as day from jsonb_array_elements(a.logs) e
      union select e->>'date' from jsonb_array_elements(a.weights) e
      union select e->>'dateISO' from jsonb_array_elements(a.sessions) e
    ) d
    where d.day is not null and d.day <> ''
  )
  select b.id, b.email, b.created_at,
    (b.data is not null and jsonb_typeof(b.data->'profile') = 'object') as has_profile,
    nullif(b.data->'buddy'->>'name', '') as buddy_name,
    coalesce((select count(distinct d.day) from days d where d.id = b.id), 0)::int as active_days,
    (select max(d.day) from days d where d.id = b.id) as last_active,
    exists (select 1 from public.support_tickets t where t.user_id = b.id) as has_ticket
  from base b;
$$;

revoke all on function public.lifecycle_candidates(text, int, int) from public, anon, authenticated;
grant execute on function public.lifecycle_candidates(text, int, int) to service_role;

-- Once a day at 09:07 UTC (10:07 UK summer time): late enough not to land at 3am, early enough to
-- be read during the day. The cron secret is read from app_secrets, never hard-coded.
select cron.schedule(
  'lifecycle_email_daily',
  '7 9 * * *',
  $$
    select net.http_post(
      url := 'https://wnbksotvcjqfslrttjxy.supabase.co/functions/v1/lifecycle-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_secrets where key = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
