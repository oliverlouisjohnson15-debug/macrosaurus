// lifecycle-email: one personal "what got in the way?" email to people who signed up and then
// barely used the app. See decide.ts for who qualifies and what each variant says.
//
// Two jobs, one function (deployed with verify_jwt disabled, like push-nudge):
//   POST (pg_cron, daily, x-cron-secret)  - find candidates, claim a lifecycle_emails row, send.
//       Body { dry_run: true } lists who WOULD be emailed, and with what subject, without sending.
//       Body { preview_to: "you@x.com" } sends one of each variant to that address only.
//   GET/POST ?unsub=<user_id>&sig=<hmac>  - the unsubscribe link (and RFC 8058 one-click) in every
//       email. Records an opt-out; no sign-in needed, the HMAC is the proof.
//
// The unsubscribe HMAC is keyed off app_secrets.cron_secret, so there is nothing new to configure;
// rotating the cron secret just invalidates old unsubscribe links. RESEND_API_KEY is the same
// function secret the support function already uses.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { KIND, MIN_DAYS, MAX_DAYS, pickVariant, compose, unsubToken, verifyUnsub, type Candidate, type Variant } from "./decide.ts";

const FROM = "Olly at Macrosaurus <olly@macrosaurus.com>";   // any address on the verified Resend domain
const REPLY_TO = "olly@macrosaurus.com";
const FN_URL = "https://wnbksotvcjqfslrttjxy.supabase.co/functions/v1/lifecycle-email";
const MAX_PER_RUN = 50;   // a ceiling, not a target: protects sender reputation if something goes wrong

Deno.serve(async (req) => {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: secretRows, error: secErr } = await admin.from("app_secrets").select("key,value");
    if (secErr) return json({ error: "secrets: " + secErr.message }, 500);
    const secrets: Record<string, string> = {};
    for (const r of secretRows || []) secrets[r.key] = r.value;
    const unsubSecret = secrets.cron_secret ? "lifecycle-unsub:" + secrets.cron_secret : "";

    // --- Unsubscribe -------------------------------------------------------------------------
    const url = new URL(req.url);
    const unsub = url.searchParams.get("unsub");
    if (unsub) {
      const ok = await verifyUnsub(unsubSecret, unsub, url.searchParams.get("sig") || "");
      if (!ok) return text("That unsubscribe link isn't valid. Reply to the email and I'll take you off by hand.", 400);
      const { error } = await admin.from("email_optouts").upsert({ user_id: unsub }, { onConflict: "user_id" });
      if (error) return text("Something went wrong unsubscribing you. Reply to the email and I'll sort it.", 500);
      return text("You're unsubscribed. You won't get any more emails like this from Macrosaurus.");
    }

    // --- Cron run ----------------------------------------------------------------------------
    if (req.method !== "POST") return text("Not found", 404);
    const provided = req.headers.get("x-cron-secret") || "";
    if (!secrets.cron_secret || provided !== secrets.cron_secret) return json({ error: "forbidden" }, 403);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { /* no body */ }
    const dryRun = body.dry_run === true;
    const previewTo = typeof body.preview_to === "string" ? body.preview_to : "";

    const key = Deno.env.get("RESEND_API_KEY");
    if (!key && !dryRun) return json({ error: "RESEND_API_KEY not set" }, 500);

    if (previewTo) {
      const fake: Candidate = { user_id: "preview", email: previewTo, created_at: new Date().toISOString(), has_profile: true, buddy_name: "Rex", active_days: 0, last_active: null, has_ticket: false };
      const sent: string[] = [];
      for (const v of ["setup", "never", "tried"] as Variant[]) {
        const m = compose(fake, v, FN_URL + "?unsub=preview&sig=preview");
        const r = await send(key!, previewTo, "[preview: " + v + "] " + m.subject, m.text, FN_URL);
        sent.push(v + ": " + (r.ok ? "sent" : "failed " + r.error));
      }
      return json({ ok: true, preview: sent });
    }

    const { data: rows, error } = await admin.rpc("lifecycle_candidates", { p_kind: KIND, p_min_days: MIN_DAYS, p_max_days: MAX_DAYS });
    if (error) return json({ error: "candidates: " + error.message }, 500);

    const now = new Date();
    const planned: { user_id: string; email: string; variant: Variant; subject: string }[] = [];
    let sent = 0, failed = 0, skipped = 0;

    for (const c of (rows || []) as Candidate[]) {
      const variant = pickVariant(c, now);
      if (!variant) { skipped++; continue; }
      if (planned.length >= MAX_PER_RUN) break;
      const unsubUrl = FN_URL + "?unsub=" + c.user_id + "&sig=" + await unsubToken(unsubSecret, c.user_id);
      const m = compose(c, variant, unsubUrl);
      planned.push({ user_id: c.user_id, email: c.email, variant, subject: m.subject });
      if (dryRun) continue;

      // Claim first: the primary key makes a second claim fail, so an overlapping run cannot double-send.
      const { error: claimErr } = await admin.from("lifecycle_emails").insert({ user_id: c.user_id, kind: KIND, variant });
      if (claimErr) { skipped++; continue; }
      const r = await send(key!, c.email, m.subject, m.text, unsubUrl);
      if (r.ok) {
        sent++;
        if (r.id) await admin.from("lifecycle_emails").update({ resend_id: r.id }).eq("user_id", c.user_id).eq("kind", KIND);
      } else {
        failed++;
        console.error("lifecycle-email: send failed", c.user_id, r.error);
        // Release the claim so tomorrow's run can try again.
        await admin.from("lifecycle_emails").delete().eq("user_id", c.user_id).eq("kind", KIND);
      }
    }

    return json({ ok: true, dry_run: dryRun, candidates: (rows || []).length, sent, failed, skipped, planned: dryRun ? planned : planned.length });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

async function send(key: string, to: string, subject: string, body: string, unsubUrl: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to,
        reply_to: REPLY_TO,
        subject,
        text: body,
        // One-click unsubscribe (RFC 8058). Gmail and Yahoo expect it from bulk senders, and it
        // gives people a way out that is not the spam button.
        headers: { "List-Unsubscribe": "<" + unsubUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
    if (!res.ok) return { ok: false, error: res.status + " " + await res.text() };
    const out = await res.json().catch(() => ({}));
    return { ok: true, id: out.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
function text(s: string, status = 200) {
  return new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
