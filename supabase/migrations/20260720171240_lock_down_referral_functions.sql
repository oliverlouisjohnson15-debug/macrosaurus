-- Security fix: the referral / rewards SECURITY DEFINER functions were never revoked from the
-- anon/authenticated roles, so they were callable directly via /rest/v1/rpc/... by anyone. Because
-- they trust their `p_user` / `p_referrer` arguments instead of auth.uid(), an attacker could grant
-- themselves (or anyone) referral bonuses, mint referral codes, drain another user's bonus pool, or
-- wipe pending rewards. They are only ever invoked by the `referral` edge function using the service
-- role, so removing the client grants closes the hole with no functional change (mirrors the
-- lock_down_security_definer_functions migration for the recipe/food RPCs).
revoke all on function public.ensure_referral_code(uuid) from public, anon, authenticated;
revoke all on function public.award_referral(uuid, uuid, text, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.consume_referral_bonus(uuid) from public, anon, authenticated;
revoke all on function public.ack_pending_rewards(uuid, text[]) from public, anon, authenticated;

grant execute on function public.ensure_referral_code(uuid) to service_role;
grant execute on function public.award_referral(uuid, uuid, text, jsonb, jsonb, integer) to service_role;
grant execute on function public.consume_referral_bonus(uuid) to service_role;
grant execute on function public.ack_pending_rewards(uuid, text[]) to service_role;
