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
 * Both are service messages, not marketing: no offers, no upsell, an unsubscribe link in every one.
 * Anyone who is actually using the app, or has already written to us via support, hears nothing.
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
export type Kind = "activation_nudge" | "inactive_feedback";
export const NUDGE: Kind = "activation_nudge";
export const FEEDBACK: Kind = "inactive_feedback";
// Sign-up age windows, in whole days. Disjoint, so one daily run can never send both to one person.
// The 21-day ceiling also stops the first deploy emailing the whole backlog of older sign-ups.
export const WINDOWS: Record<Kind, { min: number; max: number }> = {
  activation_nudge: { min: 1, max: 3 },
  inactive_feedback: { min: 7, max: 21 },
};
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
};
export type Variant = "setup" | "never" | "tried";
export type Email = { kind: Kind; variant: Variant; subject: string; text: string };

function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso)) / 86400000);
}

export function pickVariant(kind: Kind, c: Candidate, now: Date): Variant | null {
  if (!c.email) return null;
  if (c.has_ticket) return null;                 // they have already told us something; do not pester
  const age = daysSince(c.created_at, now);
  const w = WINDOWS[kind];
  if (age < w.min || age > w.max) return null;
  if (!c.has_profile) return "setup";
  if (c.active_days === 0) return "never";
  // Somebody who used it once and stopped gets asked why, but is not nudged in their first days:
  // they have already done the thing the nudge asks for.
  if (kind === FEEDBACK && c.active_days <= TRIED_MAX_DAYS && c.last_active && daysSince(c.last_active, now) >= TRIED_QUIET_DAYS) return "tried";
  return null;                                   // they are using it: say nothing
}

const SIGN = "\n\nOlly\nFounder, Macrosaurus";
const footer = (unsubUrl: string) =>
  "\n\n--\nYou're getting this because you signed up to Macrosaurus. I'll only ever send two of these. " +
  "Don't want them? Unsubscribe: " + unsubUrl;
const numbered = (opts: string[]) => opts.map((o, i) => (i + 1) + ". " + o).join("\n");

// Plain text on purpose: it reads like a note from a person, lands in the main inbox rather than
// promotions, and invites a reply. Short sentences, British, no em dashes (the app's copy voice).
export function compose(kind: Kind, variant: Variant, unsubUrl: string): Email {
  let subject: string, body: string;
  if (kind === NUDGE && variant === "setup") {
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
  return { kind, variant, subject, text: body + SIGN + footer(unsubUrl) };
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
