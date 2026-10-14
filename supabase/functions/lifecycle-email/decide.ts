/*
 * decide.ts - Who gets a "getting started" email, which one, and what it says.
 *
 * A lot of people sign up and then never really start. Two plain-text emails from Olly, at most,
 * ever, per person:
 *
 *   nudge     (day 1-3)   Still not using it. One small concrete action: log one meal, the fast way.
 *                         Return rates fall off sharply with every day missed, so this goes early.
 *   feedback  (day 7-21)  Still not using it, or tried it on a day or two and stopped. One question,
 *                         answerable by replying with a number, because a single embedded question
 *                         gets far more answers than an open "any feedback?".
 *
 * Two more, each sent at most once ever, and not tied to sign-up age:
 *
 *   cancel    A paid or trial subscription was cancelled in the last fortnight. One question: why?
 *   winback   A regular (7+ active days) who has gone quiet for 14-45 days, and did not tell us they
 *             were away or pause their goal. Points at the comeback the app already rewards.
 *
 * All are service messages, not marketing: no offers, no upsell, an unsubscribe link in every one.
 * Anyone who is actually using the app, or has already written to us via support, hears nothing.
 * A win-back never lands within MIN_GAP_DAYS of any other lifecycle email.
 *
 * Variant, picked by how far they got:
 *   setup  - signed up but never finished setting up (no profile)
 *   never  - set up, but never logged a meal, weight or session
 *   tried  - active on a day or two, then quiet for a while (feedback email only)
 *
 * Kept free of Deno and npm imports so index.ts can import it in the edge runtime and
 * tests/lifecycle-email.test.js can import the very same file under node --experimental-strip-types.
 * Pure: no clock, no network, no database. The caller passes `now`.
 */
export type Kind = "activation_nudge" | "inactive_feedback" | "cancel_feedback" | "winback";
export const NUDGE: Kind = "activation_nudge";
export const FEEDBACK: Kind = "inactive_feedback";
export const CANCEL: Kind = "cancel_feedback";
export const WINBACK: Kind = "winback";
export const KINDS: Kind[] = [NUDGE, FEEDBACK, CANCEL, WINBACK];
// Sign-up age windows, in whole days (max null = no ceiling). The two getting-started windows are
// disjoint, so one daily run can never send both to one person, and the 21-day ceiling stops the
// first deploy emailing the whole backlog of older sign-ups.
export const WINDOWS: Record<Kind, { min: number; max: number | null }> = {
  activation_nudge: { min: 1, max: 3 },
  inactive_feedback: { min: 7, max: 21 },
  cancel_feedback: { min: 0, max: null },
  winback: { min: 21, max: null },
};
export const MIN_GAP_DAYS = 14;        // a win-back waits this long after any other lifecycle email
export const CANCEL_RECENT_DAYS = 14;  // only cancellations this fresh: no backlog blast on deploy
export const WINBACK_MIN_ACTIVE = 7;   // a "regular": active on at least this many days
export const WINBACK_QUIET_MIN = 14;   // quiet for at least this long...
export const WINBACK_QUIET_MAX = 45;   // ...but not so long that the email arrives from nowhere
export const TRIED_MAX_DAYS = 2;     // "tried it" means active on at most this many days
export const TRIED_QUIET_DAYS = 5;   // ...and nothing for at least this long

export type Candidate = {
  user_id: string;
  email: string;
  created_at: string;
  has_profile: boolean;
  buddy_name: string | null;
  active_days: number;
  last_active: string | null;   // YYYY-MM-DD
  has_ticket: boolean;
  // Present from the second candidates migration on; optional so older rows/tests still type-check.
  paused?: boolean;
  plan_end?: string | null;          // latest end date of any declared away/holiday window
  last_email_at?: string | null;     // last lifecycle email of ANY kind
  sub_status?: string | null;
  sub_plan?: string | null;
  sub_cancel_at_period_end?: boolean;
  sub_period_end?: string | null;
  sub_updated_at?: string | null;
};
export type Variant = "setup" | "never" | "tried" | "ending" | "ended" | "lapsed";
// What the copy needs beyond the variant. All optional: previews pass nothing.
export type Context = { buddy?: string | null; activeDays?: number; quietDays?: number; periodEnd?: string | null };
export type Email = { kind: Kind; variant: Variant; subject: string; text: string; html: string };

function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso)) / 86400000);
}

export function pickVariant(kind: Kind, c: Candidate, now: Date): Variant | null {
  if (!c.email) return null;
  const age = daysSince(c.created_at, now);
  const w = WINDOWS[kind];
  if (age < w.min || (w.max != null && age > w.max)) return null;

  if (kind === CANCEL) {
    if (c.sub_plan === "comp") return null;              // a free grant ending is not a cancellation
    const cancelled = c.sub_status === "canceled" || !!c.sub_cancel_at_period_end;
    if (!cancelled || !c.sub_updated_at || daysSince(c.sub_updated_at, now) > CANCEL_RECENT_DAYS) return null;
    // Still paid up until a future date: tell them that, rather than implying it has already gone.
    const ending = c.sub_status !== "canceled" && !!c.sub_period_end && Date.parse(c.sub_period_end) > now.getTime();
    return ending ? "ending" : "ended";
  }

  if (kind === WINBACK) {
    // Unprompted and open-ended, so space it out from whatever we last sent (a cancellation email,
    // the getting-started pair). Those two keep to their own fixed windows instead.
    if (c.last_email_at && daysSince(c.last_email_at, now) < MIN_GAP_DAYS) return null;
    if (c.paused) return null;                           // a paused goal is never chased
    if (c.active_days < WINBACK_MIN_ACTIVE || !c.last_active) return null;
    const quiet = daysSince(c.last_active, now);
    if (quiet < WINBACK_QUIET_MIN || quiet > WINBACK_QUIET_MAX) return null;
    // They told us they would be away after their last log: the silence is the plan working.
    if (c.plan_end && c.plan_end >= c.last_active) return null;
    return "lapsed";
  }

  if (c.has_ticket) return null;                 // they have already told us something; do not pester
  if (!c.has_profile) return "setup";
  if (c.active_days === 0) return "never";
  // Somebody who used it once and stopped gets asked why, but is not nudged in their first days:
  // they have already done the thing the nudge asks for.
  if (kind === FEEDBACK && c.active_days <= TRIED_MAX_DAYS && c.last_active && daysSince(c.last_active, now) >= TRIED_QUIET_DAYS) return "tried";
  return null;                                   // they are using it: say nothing
}

export function contextFor(c: Candidate, now: Date): Context {
  return {
    buddy: c.buddy_name,
    activeDays: c.active_days,
    quietDays: c.last_active ? daysSince(c.last_active, now) : undefined,
    periodEnd: c.sub_period_end ?? null,
  };
}

const SIGN = "\n\nOlly\nFounder, Macrosaurus";
const FOOTERS: Record<Kind, string> = {
  activation_nudge: "You're getting this because you signed up to Macrosaurus. I'll only ever send two of these.",
  inactive_feedback: "You're getting this because you signed up to Macrosaurus. I'll only ever send two of these.",
  cancel_feedback: "You're getting this one-off email because you cancelled your Macrosaurus subscription.",
  winback: "You're getting this one-off email because you haven't used Macrosaurus for a little while.",
};
const footer = (kind: Kind, unsubUrl: string) => "\n\n--\n" + FOOTERS[kind] + " Don't want these? Unsubscribe: " + unsubUrl;

// The HTML part is the same note, unstyled, so it still reads like a personal email: paragraphs,
// line breaks, links made clickable, and the unsubscribe as a word rather than a long URL. The text
// part (with the full URL) stays alongside it for clients that only show plain text.
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function toHtml(body: string, footerText: string, unsubUrl: string): string {
  const paras = body.split("\n\n").map((p) =>
    "<p>" + esc(p).replace(/https:\/\/[^\s<]+/g, (u) => '<a href="' + u + '">' + u + "</a>").replace(/\n/g, "<br>") + "</p>");
  return '<div style="font-family:sans-serif;font-size:15px;line-height:1.5">' + paras.join("") +
    '<p style="color:#888;font-size:12px">' + esc(footerText) + ' <a href="' + esc(unsubUrl) + '" style="color:#888">Unsubscribe</a></p></div>';
}
const numbered = (opts: string[]) => opts.map((o, i) => (i + 1) + ". " + o).join("\n");

// Plain text on purpose: it reads like a note from a person, lands in the main inbox rather than
// promotions, and invites a reply. Short sentences, British, no em dashes (the app's copy voice).
// "14 November", for the cancellation email. Fixed to UK wording regardless of server locale.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(iso: string): string {
  const d = new Date(iso);
  return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
}

export function compose(kind: Kind, variant: Variant, unsubUrl: string, ctx: Context = {}): Email {
  let subject: string, body: string;
  const buddy = ctx.buddy ? String(ctx.buddy).slice(0, 24) : null;
  if (kind === CANCEL) {
    subject = "Sorry to see you go";
    const keep = variant === "ending" && ctx.periodEnd
      ? "You keep Premium until " + longDate(ctx.periodEnd) + ", and after that your account and everything you've logged stay put on the free plan."
      : "Your account and everything you've logged stay put on the free plan.";
    body = "Hi,\n\n" +
      "I saw you cancelled Macrosaurus Premium. No hard feelings, and thank you for giving it a go. " + keep + "\n\n" +
      "Could you tell me why you cancelled? Just reply with a number:\n\n" +
      numbered([
        "Too expensive",
        "I wasn't using it enough",
        "It was missing something I needed",
        "Something wasn't working properly",
        "I reached my goal",
        "I switched to another app",
      ]) + "\n\n" +
      "Or tell me in your own words. It comes straight to me, and it really does shape what I build next.";
  } else if (kind === WINBACK) {
    subject = buddy ? buddy + " has been asking after you" : "It's been a little while";
    const days = ctx.activeDays && ctx.activeDays > 1 ? "You logged " + ctx.activeDays + " days with Macrosaurus" : "You were getting going with Macrosaurus";
    const when = ctx.quietDays != null && ctx.quietDays >= 21 ? "a few weeks ago" : "a couple of weeks ago";
    body = "Hi,\n\n" +
      days + ", then things went quiet " + when + ". No guilt at all, life happens.\n\n" +
      (buddy || "Your dino") + " is having a nap in the meantime. Log anything today and they'll wake up, " +
      "with a bit of Amber as a welcome back. Everything you logged is still there: https://macrosaurus.com/?action=log\n\n" +
      "And if something about the app stopped working for you, I'd really like to know. Just reply, it comes straight to me.";
  } else if (kind === NUDGE && variant === "setup") {
    subject = "Pick up where you left off";
    body = "Hi,\n\n" +
      "You started setting up Macrosaurus the other day but didn't quite finish. There isn't much left, " +
      "and at the end you'll have your daily targets and an egg to hatch.\n\n" +
      "Carry on here: https://macrosaurus.com\n\n" +
      "If something put you off, just reply and tell me. I read every reply.";
  } else if (kind === NUDGE) {
    subject = "Your egg is waiting for its first meal";
    body = "Hi,\n\n" +
      "You're all set up, so there's just one thing to do today: log one meal.\n\n" +
      "The quickest way is to take a photo of your plate or scan a barcode, and the app works out the rest. " +
      "It takes less than a minute.\n\n" +
      "Log a meal: https://macrosaurus.com/?action=log\n\n" +
      "Every meal you log brings your egg closer to hatching. If something's stopping you, just reply. I read every one.";
  } else if (variant === "tried") {
    subject = "Quick question";
    body = "Hi,\n\n" +
      "You gave Macrosaurus a go recently and then stopped. That's completely fine, but I'd really like to know " +
      "what didn't work, so I can fix it.\n\n" +
      "Just reply with a number:\n\n" +
      numbered([
        "Logging took too long",
        "Couldn't find my foods",
        "The targets didn't feel right for me",
        "It was missing something I needed",
        "I just got busy",
      ]) + "\n\n" +
      "Or tell me in your own words, good or bad. It comes straight to me.\n\n" +
      "And if you did just get busy, everything you logged is still there: https://macrosaurus.com";
  } else {
    subject = "Can I ask you one thing?";
    const opts = variant === "setup"
      ? ["Setting up took too long", "It asked for things I didn't want to share", "It wasn't what I expected", "I just got busy"]
      : ["Logging food felt like too much effort", "Couldn't find my foods", "Wasn't sure what to do next", "It wasn't what I expected", "I just got busy"];
    body = "Hi,\n\n" +
      "You signed up to Macrosaurus recently but haven't really got going with it. That's fine, " +
      "but I'd love to know why, so I can make it better.\n\n" +
      "What got in the way? Just reply with a number:\n\n" +
      numbered(opts) + "\n\n" +
      "Or tell me in your own words. Even one line helps, and it comes straight to me.";
  }
  return { kind, variant, subject, text: body + SIGN + footer(kind, unsubUrl), html: toHtml(body + SIGN, FOOTERS[kind], unsubUrl) };
}

// --- Unsubscribe tokens ----------------------------------------------------------------------
// An unsubscribe link must work without signing in, so it carries the user id plus an HMAC of it.
// Web Crypto only (available in both Deno and node), so the tests exercise the real thing.
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function unsubToken(secret: string, userId: string): Promise<string> {
  return hmacHex(secret, "unsub:" + userId);   // namespaced so the token is useless for anything else
}
export async function verifyUnsub(secret: string, userId: string, sig: string): Promise<boolean> {
  if (!secret || !userId || !sig) return false;
  const want = await unsubToken(secret, userId);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
