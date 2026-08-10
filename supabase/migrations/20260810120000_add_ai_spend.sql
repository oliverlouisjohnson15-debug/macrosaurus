-- Spend-only sibling of add_ai_usage.
--
-- The buddy conversation is a client-executed tool loop, so ONE user turn can be several requests
-- to the proxy. Charging the free monthly allowance per request would drain a 10-a-month budget
-- several times faster than the meter shown beside it claims. add_ai_usage bumps spend AND the
-- call count together, so the proxy calls it once per turn (hop 0) and this one for later hops:
-- the money is recorded truthfully on every hop, keeping the Premium fair-use ceiling honest,
-- while the count that gates the free tier moves once per thing the user actually asked for.
create or replace function public.add_ai_spend(p_user uuid, p_period text, p_cost numeric)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_total numeric;
begin
  insert into public.ai_usage (user_id, period, spend_usd, calls, updated_at)
  values (p_user, p_period, p_cost, 0, now())
  on conflict (user_id, period)
  do update set spend_usd = public.ai_usage.spend_usd + excluded.spend_usd,
                updated_at = now()
  returning spend_usd into new_total;
  return new_total;
end;
$function$;

-- Only the proxy (service_role) ever calls this; a client that could call it directly could
-- rewrite its own bill.
revoke all on function public.add_ai_spend(uuid, text, numeric) from public, anon, authenticated;
