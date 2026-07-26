// push-nudge: the buddy reaches you outside the app.
//
// Invoked hourly by pg_cron (via pg_net) with an `x-cron-secret` header. Each subscription has two
// windows a day: the owner's chosen nudge_hour, and STREAK_SAVE_HOUR in the evening. In whichever
// window is open, decide.ts picks the single most useful thing the buddy has to say (streak-save >
// hatch > peckish > overdue check-in) or stays silent. Each window has its own dedupe marker
// (last_nudge_date / last_streaksave_date), so both are capped at one per local day and a user only
// ever gets two when they were nudged, still logged nothing by the evening, and had a run to lose.
// Expired subscriptions (404/410) are pruned. Deployed with verify_jwt disabled because it
// authenticates itself with the shared cron secret below.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
// The ladder that decides whether to send and what to say lives in its own Deno/npm-free module so
// it can be unit-tested under node (see tests/push-nudge.test.js).
import { decideNudge, STREAK_SAVE_HOUR, type Nudge } from "./decide.ts";

Deno.serve(async (req) => {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Server secrets live in the deny-all app_secrets table (service_role only).
    const { data: secretRows, error: secErr } = await admin.from("app_secrets").select("key,value");
    if (secErr) return json({ error: "secrets: " + secErr.message }, 500);
    const secrets: Record<string, string> = {};
    for (const r of secretRows || []) secrets[r.key] = r.value;

    // Authenticate the caller (pg_cron and manual tests both pass x-cron-secret).
    const provided = req.headers.get("x-cron-secret") || "";
    if (!secrets.cron_secret || provided !== secrets.cron_secret) return json({ error: "forbidden" }, 403);

    if (!secrets.vapid_public || !secrets.vapid_private) return json({ error: "vapid keys missing" }, 500);
    webpush.setVapidDetails(secrets.vapid_subject || "mailto:hello@macrosaurus.app", secrets.vapid_public, secrets.vapid_private);

    // Body: { test: true } forces a send to every enabled sub, ignoring hour/logged gating (for a
    // one-off delivery check). Normal cron calls pass no body.
    let reqBody: Record<string, unknown> = {};
    try { reqBody = await req.json(); } catch (_) { /* no body */ }
    const force = reqBody.test === true;

    const { data: subs, error: subErr } = await admin.from("push_subscriptions").select("*").eq("enabled", true);
    if (subErr) return json({ error: "subs: " + subErr.message }, 500);

    const now = new Date();
    let sent = 0, skipped = 0, pruned = 0, failed = 0;

    for (const sub of subs || []) {
      const { date: localDate, hour: localHour } = localParts(now, sub.tz || "UTC");

      // Two windows a day, each with its own dedupe marker (see the streak-save migration):
      //   - the user's chosen nudge_hour, for the ordinary "what needs doing" push
      //   - STREAK_SAVE_HOUR, purely for a run that is about to break
      // Anything outside both is not this subscription's moment, so skip without reading their state.
      const inNormal = sub.nudge_hour != null && localHour === sub.nudge_hour && sub.last_nudge_date !== localDate;
      const inStreakSave = localHour === STREAK_SAVE_HOUR && sub.last_streaksave_date !== localDate;
      if (!force && !inNormal && !inStreakSave) { skipped++; continue; }

      let msg: Nudge | null = null;
      if (force) {
        msg = { kind: "test", title: "Rex is peckish", body: "Test nudge from Macrosaurus.", url: "/?action=log" };
      } else {
        const { data: st } = await admin.from("user_state").select("data").eq("user_id", sub.user_id).maybeSingle();
        msg = decideNudge((st && st.data) || {}, localDate, { normal: inNormal, streakSave: inStreakSave });
        if (!msg) { skipped++; continue; }
      }

      const payload = JSON.stringify({
        title: msg.title,
        body: msg.body,
        url: msg.url,
        // Tagged per kind as well as per day, so a streak-save never replaces the earlier nudge in the
        // tray (same tag would collapse them) and a repeat of the same kind still cannot stack.
        tag: "macrosaurus-" + msg.kind + "-" + localDate,
      });

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
        if (!force) {
          const mark = msg.kind === "streaksave" ? { last_streaksave_date: localDate } : { last_nudge_date: localDate };
          await admin.from("push_subscriptions").update(mark).eq("endpoint", sub.endpoint);
        }
      } catch (err) {
        const code = (err as { statusCode?: number; status?: number }).statusCode ?? (err as { status?: number }).status;
        if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); pruned++; }
        else failed++;
      }
    }

    return json({ ok: true, total: (subs || []).length, sent, skipped, pruned, failed });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
