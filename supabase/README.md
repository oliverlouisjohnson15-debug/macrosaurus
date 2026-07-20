# Supabase backend — schema, RLS & security posture

Project: **Macrosaurus** (`wnbksotvcjqfslrttjxy`), region **eu-west-2 (London)** — kept in the
UK/EU because the app stores UK users' special-category health data (weight, body fat, logs).

The `migrations/` folder is the **source of truth** for the database schema and is a faithful,
version-controlled mirror of what is deployed. Every table and function below was created by a
migration in this folder; the file version numbers match the live `schema_migrations` history.

To rebuild the database from scratch: `supabase db push` (or `supabase db reset` locally).

## Migration history

| Version | Migration | What it creates |
|---|---|---|
| 20260703121613 | create_user_state | `user_state` (the per-user app blob) + owner-only RLS |
| 20260707114413 | ai_usage_tracking | `ai_usage` + `add_ai_usage()` (server-only) |
| 20260707120307 | admin_panel_foundation | `admins`, `user_limits`, `admin_audit` |
| 20260707121737 | admin_config_and_notes | `app_config`, `support_notes` |
| 20260707205322 | ai_usage_by_model | `ai_usage_by_model` + `add_ai_usage_model()` |
| 20260708081408 | community_food_db | `food_submissions` + `submit_food_correction()` / `get_community_food()` |
| 20260711073414 | ai_logs_table | `ai_logs` (admin AI review, deny-all RLS) |
| 20260711103311 | ai_logs_purge_cron | pg_cron job purging `ai_logs` after 30 days |
| 20260711112434 | lock_down_user_state_archive_tables | RLS on `user_state_history` / `user_state_backup`; definer archive trigger |
| 20260717060051 | recipe_public_library | `recipe_public` + `submit_public_recipe()` / `browse_recipes()` |
| 20260717100937 | lock_down_security_definer_functions | REVOKE client grants on server-only definer functions |
| 20260717124729 | create_subscriptions_table | `subscriptions` (written by Stripe webhook only) |
| 20260717132958 | add_tier_config | tier columns on `app_config` |
| 20260717190202 | shared_recipe_finder | recipe taxonomy + `browse_recipe_creators()` |
| 20260717203624 | browse_recipes_main_effort | `browse_recipes()` main/effort filters |
| 20260719071757 | support_tickets | `support_tickets` |
| 20260719112946 | referrals_and_rewards | `user_rewards`, `referrals` + referral RPCs |
| 20260719173549 | google_health_connections | `google_health_connections` (refresh tokens, deny-all RLS) |
| 20260720171240 | lock_down_referral_functions | **security fix** — REVOKE client grants on referral RPCs |
| 20260720173542 | push_subscriptions | `push_subscriptions` (Web Push devices, owner-managed RLS) |
| 20260720173553 | app_secrets | `app_secrets` (server-only secrets, deny-all RLS) |
| 20260720174224 | push_nudge_cron | hourly pg_cron job → `push-nudge` edge function |

## RLS model (the important part)

Every table in `public` has RLS **enabled**. There are two deliberate patterns:

**1. Owner-readable tables** — the client reads its own row(s); writes are server-side.
- `user_state` — owner select/insert/update (the only table the client writes directly).
- `push_subscriptions` — owner-scoped select/insert/update/delete (each device manages its own Web
  Push subscription row); the `push-nudge` sender reads them as `service_role`.
- `ai_usage`, `subscriptions`, `user_rewards`, `admins`, `app_config`, `support_tickets`,
  `referrals`, `food_submissions`, `recipe_public` — owner-scoped `select` (and, for
  `food_submissions`/`recipe_public`, owner-scoped writes). All privileged writes are done by
  edge functions running as `service_role`, which bypasses RLS.

**2. Deny-all / server-only tables** — RLS enabled with **no policies on purpose**. The
`anon`/`authenticated` keys get nothing; only `service_role` (edge functions) can touch them:
`admin_audit`, `ai_logs`, `ai_usage_by_model`, `user_limits`, `support_notes`,
`user_state_history`, `user_state_backup`, `google_health_connections`, `app_secrets`.

> `app_secrets` holds the VAPID private key and the push-nudge cron secret. Values are inserted
> out-of-band (never in a committed migration) and read only by edge functions as `service_role`.

> The Supabase **security advisor** reports these eight as `rls_enabled_no_policy` (INFO). That is
> **expected and correct** — they are meant to be unreachable by client keys. Do **not** "fix"
> them by adding permissive policies; `google_health_connections` in particular holds OAuth refresh
> tokens and must never be client-readable.

## SECURITY DEFINER functions

Definer functions run with owner rights and bypass RLS, so their `EXECUTE` grants are the access
control. The rule: **server-only functions are granted to `service_role` only; user-facing RPCs are
granted to `authenticated` (never `anon`).**

- Server-only (`service_role`): `add_ai_usage`, `add_ai_usage_model`, `archive_user_state`
  (trigger), and the four referral RPCs `ensure_referral_code`, `award_referral`,
  `consume_referral_bonus`, `ack_pending_rewards`.
- User-facing (`authenticated`): `browse_recipes`, `browse_recipe_creators`,
  `submit_public_recipe`, `submit_food_correction`, `get_community_food`.

The advisor lists the `authenticated`-granted RPCs under `..._security_definer_function_executable`
(WARN). These are **intended** — they are the deduped/anonymised access path to the shared recipe
and community-food pools, and each validates input and scopes writes to `auth.uid()` internally.

## Web Push nudges (the `push-nudge` function)

The buddy reaches users outside the app. Flow:

1. **Client** (`app/src/app.jsx`) asks permission, `PushManager.subscribe()` with the VAPID **public**
   key, and upserts the subscription (endpoint, keys, IANA `tz`, `nudge_hour`) into
   `push_subscriptions`. Toggle lives in Settings → Notifications.
2. **Service worker** (`sw.js`) has `push` + `notificationclick` handlers that show the notification
   and deep-link to `/?action=log`.
3. **Sender** (`supabase/functions/push-nudge/index.ts`, `verify_jwt=false`) runs hourly via
   `push_nudge_hourly` (pg_cron → pg_net). For each enabled subscription whose **local** hour equals
   its `nudge_hour`, hasn't been nudged today (`last_nudge_date`), isn't paused, and hasn't logged
   food today, it sends one Web Push. Expired subs (404/410) are pruned. It authenticates callers
   with `x-cron-secret` (compared against `app_secrets.cron_secret`).

VAPID keys: **public** key is embedded in the client (safe); **private** key + subject live in
`app_secrets`. To rotate, generate a new P-256 keypair, update `app_secrets`, and ship the new public
key in the client (existing subscriptions must re-subscribe).

Manual delivery test (sends to every enabled device, bypassing the hour/logged gates):
```sql
select net.http_post(
  url := 'https://wnbksotvcjqfslrttjxy.supabase.co/functions/v1/push-nudge',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-cron-secret', (select value from public.app_secrets where key='cron_secret')),
  body := '{"test":true}'::jsonb);
-- then: select status_code, content from net._http_response order by id desc limit 1;
```

> **iOS/iPadOS caveat:** Safari only delivers Web Push to an **installed** (home-screen) PWA. The
> Settings toggle detects this and tells the user to Add to Home Screen first. Android/desktop
> Chrome/Firefox/Edge work in-browser.

## Outstanding security-advisor items (not code — needs a dashboard toggle)

- **Leaked-password protection is disabled.** Enable it in *Auth → Providers → Password* (checks
  new passwords against HaveIBeenPwned). One toggle, no code change.
  https://supabase.com/docs/guides/auth/password-security

Re-run the advisor after any schema change:
`get_advisors(project_id, type: 'security' | 'performance')`.
