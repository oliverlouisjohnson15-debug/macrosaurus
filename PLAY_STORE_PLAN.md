# Google Play launch

Macrosaurus ships to Play as a **Trusted Web Activity (TWA)**: a thin Android shell
that opens `app.macrosaurus.com` full-screen in Chrome, with no browser UI. The app
itself is unchanged — the same `index.html` bundle and `sw.js` that serve the web app
serve the Android app. There is no second codebase to keep in sync.

A TWA is explicitly supported by Google; a plain WebView wrapper is not, and is
rejected under the repetitive-content policy. The difference is Digital Asset Links:
the shell proves it owns the origin, and Chrome drops the URL bar.

## Files in this repo

| File | Purpose |
| --- | --- |
| `.well-known/assetlinks.json` | Digital Asset Links, served from `app.macrosaurus.com`. **Fingerprint is a placeholder** — see step 3. |
| `twa-manifest.json` | Bubblewrap config. Mirrors `manifest.webmanifest`: name, icons, theme, the three shortcuts. |

The keystore, `.aab`, and the generated `android/` project are gitignored. **Never
commit the signing key.**

## Account

**Personal account**, not organisation. Play verifies an organisation with a certificate
of incorporation, VAT certificate or charity registration; a D-U-N-S number alone does
not satisfy it, and Macrosaurus is a sole trader with none of those. Incorporating
purely to get the organisation account type would mean annual accounts, a confirmation
statement and corporation tax returns — not worth taking on pre-revenue to skip a
two-week wait. Revisit if and when there is revenue; apps can be migrated between Play
accounts later.

The cost of the personal route is the closed-testing requirement: personal accounts
created after 13 Nov 2023 must run a closed test with **12 testers opted in continuously
for 14 days** before they can apply for production access.

One-off £20 registration fee (per account, so if it was already paid partway through an
organisation signup, ask Play support to switch the account type rather than paying
again). Identity verification takes a few days.

### Step 0: closed testing

This is the long pole and should start the moment the account is verified — before the
store listing is written, since a closed test needs only an uploaded build. Descriptions
and screenshots can be produced while the 14 days run.

- Create a **Closed testing** track and upload the first `.aab`
- Recruit 12 testers by Google account email. They must opt in via the test link and
  stay opted in; Play counts continuous days, not unique installs
- After 14 continuous days, the *Apply for production access* form unlocks. It asks how
  the test was run and what was learned, so keep notes on tester feedback as it comes in

## Steps

### 1. Register the developer account
At https://play.google.com/console/signup, using the Google account that should own the
app long-term — it owns the signing keys and payouts and is painful to change later.
Account type: **Personal**. Identity verification takes a few days. Set the
public developer name and support email (`olly@macrosaurus.com`).

### 2. Create the app in Play Console
App name **Macrosaurus**, default language **English (United Kingdom)**, type **App**,
free (the subscription is billed outside the store — see Billing below).

### 3. Generate the signing key and wire up asset links
Opt in to **Play App Signing** (the default). Play holds the upload key and re-signs
with its own key, so the fingerprint that matters is Play's, not the local keystore's.

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest=https://app.macrosaurus.com/manifest.webmanifest
bubblewrap build          # produces app-release-bundle.aab
```

Upload the `.aab` once, then copy the **SHA-256 certificate fingerprint** from
Play Console → *Setup → App signing* into `.well-known/assetlinks.json`, replacing
`REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT`. Deploy, then verify:

```
https://app.macrosaurus.com/.well-known/assetlinks.json
```

If the fingerprint is wrong the app still runs but shows a URL bar at the top. That is
the symptom to look for.

### 4. Store listing
- Short description (80 chars) and full description (4000 chars)
- App icon 512×512 PNG — `icon-512.png` is the source
- Feature graphic 1024×500 — `og.png` is a starting point but is the wrong aspect ratio
- 2–8 phone screenshots, 16:9 or 9:16, min 320px on the short edge
- Category: **Health & Fitness**

### 5. Data safety form
Declare, consistent with `web/privacy.html`:
- Health and fitness data, plus email for the account
- Collected and stored, not sold, not shared with third parties for ads
- Encrypted in transit (TLS 1.2+) and at rest (AES-256)
- Users can request deletion — link to the in-app route: **Menu → Account → Delete
  account**, which removes the account and all rows

Play also requires a deletion path reachable from outside the app. Add a
`macrosaurus.com/delete-account` page describing the in-app route and offering
`olly@macrosaurus.com` as a fallback, and link it in the form.

### 6. Content rating, privacy policy, target audience
- Privacy policy URL: `https://macrosaurus.com/privacy`
- Content rating questionnaire — a nutrition tracker rates PEGI 3 / Everyone
- Target audience: 18+, to avoid the Families policy and its extra requirements
- Health apps: declare that the app does not diagnose or treat, and does not claim to

### 7. Google Health scopes — keep disabled for launch
`supabase/functions/google-health-proxy` uses restricted Google Health scopes, which
require an annual independent CASA security assessment. `web/privacy.html` already
states the connection is enabled only on internal accounts. Leave it that way for the
public build; shipping it before CASA passes will stall review.

## Billing

The subscription runs on Stripe (`supabase/functions/billing`, `stripe-webhook`).
Since June 2026, Play permits external payments in the US, UK and Europe, so Stripe
can stay — but it is not automatic:

- Enrol in the **External Content Links Program** in Play Console
- From 1 October 2026, report transactions and successful downloads, and pay Google's
  service fee — 10% on the first $1M of annual earnings, regardless of billing method

Integrating Play Billing as a second path is the alternative. Given the fee is the same
either way, keeping Stripe and enrolling is the cheaper route.

## Release

Roll out to **internal testing** first to confirm the TWA opens without a URL bar and
that camera barcode scanning, web push (`push-nudge`), and the share target all work
inside the shell. Then promote to production.

Bumping the app later means bumping `appVersionCode` in `twa-manifest.json` and
rebuilding — but only when the *shell* changes. Web app changes ship on deploy, with no
store review, which is the main reason for the TWA route.
