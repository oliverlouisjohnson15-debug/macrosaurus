# 07 · The screen stays on, and the rest alert reaches a locked phone

Two parts. Ship part A on its own first; it's small.

## Evidence

- **Wake lock** is only used in Cook ("Keep the screen awake while cooking", `app/src/app.jsx:20870`).
  The session player doesn't hold one, so the phone sleeps between sets. `35-reset/02-opengym.md`
  already ranked this "Yes, cheap".
- **Rest alert:** the countdown is stored as an end timestamp (`restRun`,
  `app/src/train-session.jsx:256–:276`) and ticked by a 1 s interval (`:313`). `restAlert`
  (`:1953`) beeps and vibrates, and falls back to `reg.showNotification` only while the page is
  still running JavaScript. Its own comment admits that on iOS, with the screen off, it "may arrive
  late or not at all".
- **Push plumbing already exists:**
  - VAPID keys in `app_secrets`
  - `push_subscriptions` table (`supabase/migrations/20260720173542_push_subscriptions.sql`)
  - the client subscribes (`app/src/app.jsx:19530`)
  - `sw.js` shows a pushed payload (`:101`) and routes the click (`:117`)
  - `push-nudge` sends with `web-push` (`supabase/functions/push-nudge/index.ts`), but only on an
    hourly cron.

## Part A · Wake lock in the session (S)

1. Take the acquire/re-acquire pattern from `app/src/app.jsx:20870–:20885` and move it into a shared
   hook, `useWakeLock(active)`, in `app/src/train-core.jsx` (or wherever app-wide hooks live; check
   for an existing hooks section first). Cook switches to the hook too. Same behaviour, one copy.
2. `SessionPlayer` calls `useWakeLock(!past)`. It holds the lock while a live session is open and
   re-acquires on `visibilitychange`.
3. Add a Training setting `prefs.keepAwake` (default **true**): a `Row` with a toggle in
   `TrainSettings` (`app/src/train.jsx:1086`), "Keep the screen on in a session".
4. Test: a render test in which `navigator.wakeLock.request` is stubbed, called on mount and
   released on unmount.

## Part B · A rest alert from the server (M, spike first, owner decision D4)

### Spike (half a day, written up in the PR before any UI)

Find out whether a Supabase edge function can send a web push N seconds later (60–300 s) reliably:

- Option 1: `EdgeRuntime.waitUntil(sleep(ms).then(send))` inside the request. Check the wall-clock
  limit on the project's plan.
- Option 2: write a row `{ user_id, send_at, payload }` to a new `rest_alerts` table and have
  `pg_cron` poll it every 10 s via `pg_net`. Check whether `pg_cron` on this project allows
  sub-minute schedules (`'10 seconds'` syntax, pg_cron ≥ 1.5).

Measure the delivery delay on an iPhone home-screen PWA with the screen locked, 10 runs each.
Ship whichever option lands within ±5 s in 9 of 10 runs. If neither does, stop and ship Part A only.

### If it passes

1. New edge function `rest-alert` (deployed with `verify_jwt` **on**):
   - `POST { endsAt }` schedules. `DELETE` cancels.
   - It sends to the caller's own `push_subscriptions` rows only, with
     `{ title: 'Rest over', body: 'Next set.', tag: 'rest-timer', url: '/?tab=train' }`.
   - Reuse `push-nudge`'s VAPID setup by moving it into a shared module.
   - Cap: one pending alert per user. A new POST replaces the old one. Reject `endsAt` more than 10
     minutes ahead.
2. Client: in `setRest` (`train-session.jsx:261`), when a rest starts and push is subscribed, POST
   `endsAt`. When the rest is cleared, skipped or changed, POST the new `endsAt` or send DELETE. It's
   fire-and-forget; a failure only means the in-page alert is the only alert, as today.
3. No double alert: the service worker's `push` handler skips `showNotification` for tag
   `rest-timer` when a visible client exists (`self.clients.matchAll`), because the page already
   beeped.
4. Settings row: "Rest alert when the phone is locked", shown only when push is available. Default
   on once push is granted.
5. Tests: `tests/push-nudge.test.js` style unit tests for the scheduling and cancel rules (pure
   module), plus the `sw.js` suppression rule.

## Status

- **Part A is built.** `useWakeLock` (`app/src/app.jsx`, beside `useBackClose`) is used by Cook and by the
  session player, which holds it only while a live session is open and `prefs.keepAwake` is not off
  (Training settings, "Keep the screen on"). `tests/wake-lock.test.js` covers it with a stand-in API.
- **Part B is not built, and should not be until it is measured on a phone.** What the spike has found
  so far, from the Macrosaurus project: `pg_cron` is 1.6.4, which accepts sub-minute schedules, and
  `pg_net` 0.20.3 is installed, so option 2 (a `rest_alerts` table polled every 10 s) is possible. What
  cannot be found from a desk is the thing the plan's pass mark depends on: how late a web push lands
  on an iPhone home-screen PWA with the screen locked. That needs ten real runs per option.
