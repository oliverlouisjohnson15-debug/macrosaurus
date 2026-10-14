-- Two more lifecycle emails (cancellation feedback, win-back for lapsed regulars) and an activation
-- funnel for the admin panel.
--
-- lifecycle_candidates gains the columns those need: paused / declared-away state, when the user
-- last got ANY lifecycle email (so emails are spaced out), and their subscription. p_max_days may
-- now be null for "no sign-up ceiling" (win-back and cancellation are not tied to sign-up age).
-- Return type changes, so drop and recreate; the deployed function only reads the columns it knows.
drop function if exists public.lifecycle_candidates(text, int, int);
create function public.lifecycle_candidates(p_kind text, p_min_days int, p_max_days int)
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  has_profile boolean,
  buddy_name text,
  active_days int,
  last_active text,
  has_ticket boolean,
  paused boolean,
  plan_end text,
  last_email_at timestamptz,
  sub_status text,
  sub_plan text,
  sub_cancel_at_period_end boolean,
  sub_period_end timestamptz,
  sub_updated_at timestamptz
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
      and (p_max_days is null or u.created_at > now() - make_interval(days => p_max_days))
      and not exists (select 1 from public.email_optouts o where o.user_id = u.id)
      and not exists (select 1 from public.lifecycle_emails l where l.user_id = u.id and l.kind = p_kind)
  ),
  arr as (
    select b.id,
      case when jsonb_typeof(b.data->'log_entries') = 'array' then b.data->'log_entries' else '[]'::jsonb end as logs,
      case when jsonb_typeof(b.data->'weight_entries') = 'array' then b.data->'weight_entries' else '[]'::jsonb end as weights,
      case when jsonb_typeof(b.data->'training'->'logs') = 'array' then b.data->'training'->'logs' else '[]'::jsonb end as sessions,
      case when jsonb_typeof(b.data->'week_plans') = 'array' then b.data->'week_plans' else '[]'::jsonb end as plans
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
    exists (select 1 from public.support_tickets t where t.user_id = b.id) as has_ticket,
    case when jsonb_typeof(b.data->'paused') = 'boolean' then (b.data->'paused')::boolean else false end as paused,
    (select max(p->>'end') from arr a, jsonb_array_elements(a.plans) p where a.id = b.id) as plan_end,
    (select max(l.sent_at) from public.lifecycle_emails l where l.user_id = b.id) as last_email_at,
    sub.status, sub.plan, coalesce(sub.cancel_at_period_end, false), sub.current_period_end, sub.updated_at
  from base b
  left join public.subscriptions sub on sub.user_id = b.id;
$$;

revoke all on function public.lifecycle_candidates(text, int, int) from public, anon, authenticated;
grant execute on function public.lifecycle_candidates(text, int, int) to service_role;

-- Activation funnel for everyone who signed up in the last p_days days, for the admin panel. Counts
-- only, no identities. "Came back" means active on some day at least a week after signing up, the
-- clearest single sign that the app became a habit rather than a try.
create or replace function public.activation_funnel(p_days int)
returns table (
  signed_up int,
  confirmed int,
  set_up int,
  first_log int,
  came_back int,
  active_7d int
)
language sql
security definer
set search_path = public, auth
as $$
  with u as (
    select u.id, u.created_at, u.email_confirmed_at, s.data
    from auth.users u left join public.user_state s on s.user_id = u.id
    where u.created_at > now() - make_interval(days => p_days)
  ),
  days as (
    select u.id, u.created_at, case when d.day ~ '^\d{4}-\d{2}-\d{2}$' then d.day::date end as day
    from u
    cross join lateral (
      select e->>'date' as day from jsonb_array_elements(case when jsonb_typeof(u.data->'log_entries') = 'array' then u.data->'log_entries' else '[]'::jsonb end) e
      union select e->>'date' from jsonb_array_elements(case when jsonb_typeof(u.data->'weight_entries') = 'array' then u.data->'weight_entries' else '[]'::jsonb end) e
      union select e->>'dateISO' from jsonb_array_elements(case when jsonb_typeof(u.data->'training'->'logs') = 'array' then u.data->'training'->'logs' else '[]'::jsonb end) e
    ) d
    where d.day ~ '^\d{4}-\d{2}-\d{2}$'
  )
  select
    count(*)::int,
    count(*) filter (where u.email_confirmed_at is not null)::int,
    count(*) filter (where jsonb_typeof(u.data->'profile') = 'object')::int,
    (select count(distinct id) from days)::int,
    (select count(distinct id) from days where day >= (created_at + interval '7 days')::date)::int,
    (select count(distinct id) from days where day >= (now() - interval '7 days')::date)::int
  from u;
$$;

revoke all on function public.activation_funnel(int) from public, anon, authenticated;
grant execute on function public.activation_funnel(int) to service_role;
