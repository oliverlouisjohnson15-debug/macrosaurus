-- Server-only: called by the edge proxy as service_role. No client role should call it.
REVOKE ALL ON FUNCTION public.add_ai_usage_model(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_ai_usage_model(uuid, text, text, numeric) TO service_role;

-- Trigger function only; must not be reachable via /rpc.
REVOKE ALL ON FUNCTION public.archive_user_state() FROM PUBLIC, anon, authenticated;

-- Community/recipe RPCs: logged-in users only, never anonymous.
REVOKE ALL ON FUNCTION public.browse_recipes(numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.browse_recipes(numeric, numeric, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_community_food(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_food(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_food_correction(text, numeric, numeric, numeric, numeric, numeric, text, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_food_correction(text, numeric, numeric, numeric, numeric, numeric, text, numeric, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_public_recipe(text, text, text, integer, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_public_recipe(text, text, text, integer, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, boolean) TO authenticated, service_role;

-- Re-enable autovacuum on user_state (recovery of the July dead tuples is impossible on managed Postgres).
ALTER TABLE public.user_state SET (autovacuum_enabled = true);
