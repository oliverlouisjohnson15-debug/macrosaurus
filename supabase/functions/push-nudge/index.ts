// push-nudge: the buddy reaches you outside the app.
//
// Invoked hourly by pg_cron (via pg_net) with an `x-cron-secret` header. For every enabled push
// subscription whose owner's LOCAL time is their chosen nudge hour and who has not logged food today,
// it sends a Web Push "your buddy is peckish" nudge. At most one nudge per local day per device
// (last_nudge_date dedupe). Expired subscriptions (404/410) are pruned. Deployed with verify_jwt
// disabled because it authenticates itself with the shared cron secret below.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

      if (!force) {
        if (sub.nudge_hour == null || localHour !== sub.nudge_hour) { skipped++; continue; }
        if (sub.last_nudge_date === localDate) { skipped++; continue; }
      }

      let buddyName = "Rex";
      if (!force) {
        const { data: st } = await admin.from("user_state").select("data").eq("user_id", sub.user_id).maybeSingle();
        const d = (st && st.data) || {};
        if (d.paused) { skipped++; continue; }
        const logged = Array.isArray(d.log_entries) && d.log_entries.some((e: { date?: string }) => e && e.date === localDate);
        if (logged) { skipped++; continue; }
        if (d.buddy && d.buddy.name) buddyName = String(d.buddy.name).slice(0, 24);
      }

      const payload = JSON.stringify({
        title: buddyName + " is peckish",
        body: "You have not logged today. Tap to feed it before the day slips away.",
        url: "/?action=log",
        tag: "macrosaurus-nudge-" + localDate,
      });

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
        if (!force) await admin.from("push_subscriptions").update({ last_nudge_date: localDate }).eq("endpoint", sub.endpoint);
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

// Local calendar date (YYYY-MM-DD) and 0-23 hour for an IANA timezone.
function localParts(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => { const p = parts.find((x) => x.type === t); return p ? p.value : ""; };
  let hour = parseInt(g("hour"), 10);
  if (hour === 24 || isNaN(hour)) hour = 0;
  return { date: g("year") + "-" + g("month") + "-" + g("day"), hour };
}
