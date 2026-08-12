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

## Recipe import (the `recipe-extract` function)

Sharing a Reel/Short/TikTok into the app has to end in a real recipe, and most cooking videos never
write one down: it is **spoken**, and shown **on screen**. The function reads as many of those
sources as it can and the client (`importRecipeFromLink` in `app/src/app.jsx`) climbs them only as
far as it needs to, stopping as soon as the draft is a real recipe (`Rcp.draftQuality`, not "did the
request succeed"):

| Rung | Source | Action | Cost |
|---|---|---|---|
| 1 | caption / description, plus the creator's spoken words from **YouTube caption tracks** and **TikTok auto-captions** | `POST {url}` | one fast AI call |
| 2 | the cover frame (when there is no video to pull) | — | one AI vision call |
| 3 | stills sampled across the video, for the on-screen ingredient card | `POST {url, action:'media'}` | one AI vision call |
| 4 | speech-to-text of the audio | `POST {url, action:'transcribe'}` | AI call **+ transcription** |

**Instagram is the awkward one.** It publishes no subtitle track, so rung 1 can only ever read its
caption — a Reel's recipe is on screen, which makes rung 3 (and therefore getting the video) the
whole game. So for Instagram the function first converts the shortcode in the share link back to a
media id (`shortcodeToMediaId` — the shortcode *is* the id in base64) and calls the same
`/api/v1/media/{id}/info/` endpoint Instagram's own web client calls, which returns the full caption
(og:description only carries a truncated copy), a playable MP4, the cover and the real creator
handle in one request. The embed-page scrapers stay as the fallback for whatever that withholds.

Rungs 1–3 add no third-party spend. `action:'media'` streams the video bytes to the **browser**,
which decodes the frames locally and sends only the few it picks to the AI; the fetch target is
always re-resolved server-side from the allow-listed share link, never taken from the request body,
so this is not an open proxy. All page parsing lives in `recipe-extract/parse.ts` and is unit-tested
(`tests/recipe-extract.test.js`) — that is the half that breaks when a platform changes shape.

**Rung 4 is opt-in and off by default.** Set these function secrets to switch it on:

| Secret | Default | What it does |
|---|---|---|
| `TRANSCRIBE_API_KEY` | *(unset — rung disabled)* | Key for an OpenAI-compatible `audio/transcriptions` endpoint |
| `TRANSCRIBE_URL` | `https://api.openai.com/v1/audio/transcriptions` | Point it at another provider |
| `TRANSCRIBE_MODEL` | `whisper-1` | Model name |
| `TRANSCRIBE_USD_PER_MIN` | `0.006` | Used only to bill the spend |

With no key set the function answers `not_configured` and the ladder simply stops one rung lower.
When it is set, each transcription's cost is recorded against the caller's monthly `ai_usage` via
`add_ai_usage`, the same pot ai-proxy uses, so the fair-use ceiling stays meaningful. Downloads are
capped at 25 MB.

## Menu import (the `menu-fetch` function)

Deploy with **`verify_jwt = true`** (`supabase functions deploy menu-fetch`). It holds no secret and
calls no paid API.

Pasting a restaurant link into the Menu tab used to give the app the restaurant's *name* and nothing
else, because `placeFromUrl` (in `app/menu.js`) deliberately never fetched the page. The app then
asked the model for dishes at a place it had no menu for, and got a card's worth of plausible
invention back — the bug that started this. `menu-fetch` closes the gap for the sites where it can
be closed: it fetches the pasted page server-side (the browser cannot, due to CORS) and tries three
routes, most exact first.

| Route | What it reads | Why it is worth trying |
|---|---|---|
| `jsonld` | `schema.org` `Menu` / `hasMenu` blocks | Dish names and prices exactly as the site declares them, no parsing guesswork |
| `pdf` | a menu PDF linked from the page | Independents publish cards as PDFs constantly, and the client already sends menu PDFs as document blocks |
| `page` | the page's own text, furniture stripped | WordPress/Squarespace/Wix sites serve their menu as text, because they need to be searchable |

When the pasted page is not itself a menu, it will follow that page's **own** links one level, same
origin only, to a menu page or a menu PDF. That is the "somebody pasted the homepage" case.

**It has to prove it found a menu.** Everything it returns has passed `looksLikeMenu` in
`menu-fetch/parse.ts`: prices in the shape a UK menu writes them over a real body of lines, or
course headings over the same. A JavaScript shell, a cookie wall, a 403 and a homepage all fail it,
and the function answers `ok:false`. The client then behaves exactly as it did before — the "I have
not seen this menu" strip, dishes badged *Unconfirmed*, and a nudge to photograph the card. So the
worst case of the whole feature is the previous behaviour; there is no route from here to a
confidently wrong menu. Chains are unaffected and unimportant here: their sites are the ones that
fail, and for them we want published nutrition anyway, which is measured rather than parsed.

**It is not an open proxy, and this is the part to be careful with.** Unlike `recipe-extract`, which
only ever fetches three named platforms, this takes whatever URL a signed-in user pastes. The guards
live in `parse.ts` (`safeUrl`, `privateIPv4`, `privateIPv6`) and are unit-tested in
`tests/menu-fetch.test.js`:

- `http(s)` only; no credentials in the URL; no ports other than 80/443.
- No loopback, private, link-local, CGNAT, multicast or reserved address, in either IP family,
  including the `::ffff:` mapped forms the URL parser normalises to hex. `169.254.169.254` and
  `metadata.google.internal` are refused by name and by number.
- Bare hostnames and `.local` / `.internal` / `.lan` style suffixes are treated as intranet names.
- Redirects are followed **by hand**, up to 4 hops, each one re-checked (`redirect: 'follow'` would
  let a public URL bounce us somewhere private without our ever seeing the address).
- Where the runtime exposes `Deno.resolveDns`, the hostname's A/AAAA records are checked too, so a
  public name pointing at a private address is refused. An unavailable resolver is not treated as a
  failure; it leaves us where the literal checks left us.
- 2 MB per page, 4.5 MB per PDF (matching the client's cap), 12 s per fetch, 25 s per request, and a
  content-type gate to HTML/PDF/plain text.
- Failures are **indistinguishable to the caller**: a private address, a typo and a 404 all come
  back as the same `ok:false`. The `diag` string that separates them goes to the function logs, not
  the response body, so this cannot be used to probe anything.

The residual risk is a DNS rebind between the resolve check and the fetch. It is accepted because
the response is never anything the caller can address or act on: only text that goes to a model, or
PDF bytes, and only when it looked like a menu.

## Outstanding security-advisor items (not code — needs a dashboard toggle)

- **Leaked-password protection is disabled.** Enable it in *Auth → Providers → Password* (checks
  new passwords against HaveIBeenPwned). One toggle, no code change.
  https://supabase.com/docs/guides/auth/password-security

Re-run the advisor after any schema change:
`get_advisors(project_id, type: 'security' | 'performance')`.
