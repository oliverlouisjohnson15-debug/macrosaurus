/*
 * decide.ts - Who gets the "how's it going?" email, and what it says.
 *
 * A lot of people sign up and then never really start. We cannot fix what we do not hear about, so
 * once, a few days in, someone who has barely used the app gets a short, plain-text email from Olly
 * asking what got in the way. Replies go straight to a real inbox. It is deliberately one email per
 * person, ever: this is a question, not a drip campaign.
 *
 * Three variants, picked by how far they got:
 *   setup  - signed up but never finished setting up (no profile)
 *   never  - set up, but never logged a meal, weight or session
 *   tried  - used it on a day or two, then went quiet for a while
 * Anyone more engaged than that, or who has already written to us via support, is left alone.
 *
 * Kept free of Deno and npm imports so index.ts can import it in the edge runtime and
 * tests/lifecycle-email.test.js can import the very same file under node --experimental-strip-types.
 * Pure: no clock, no network, no database. The caller passes `now`.
 */
export const KIND = "inactive_feedback";
export const MIN_DAYS = 3;           // give people a few days to get going before asking
export const MAX_DAYS = 21;          // past this, a "how's it going?" reads oddly; also stops a backlog blast
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
export type Email = { variant: Variant; subject: string; text: string };

function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso)) / 86400000);
}

export function pickVariant(c: Candidate, now: Date): Variant | null {
  if (!c.email) return null;
  if (c.has_ticket) return null;                 // they have already told us something; do not pester
  const age = daysSince(c.created_at, now);
  if (age < MIN_DAYS || age > MAX_DAYS) return null;
  if (!c.has_profile) return "setup";
  if (c.active_days === 0) return "never";
  if (c.active_days <= TRIED_MAX_DAYS && c.last_active && daysSince(c.last_active, now) >= TRIED_QUIET_DAYS) return "tried";
  return null;                                   // they are using it: say nothing
}

// Plain text on purpose. It is meant to read like a note from a person, which is also what gets it
// into the inbox rather than the promotions tab, and what gets people to hit reply.
export function compose(c: Candidate, variant: Variant, unsubUrl: string): Email {
  const buddy = c.buddy_name ? String(c.buddy_name).slice(0, 24) : null;
  const sign = "\n\nThanks,\nOlly\nMacrosaurus";
  const footer = "\n\n--\nYou're getting this one-off email because you signed up to Macrosaurus. " +
    "If you'd rather not hear from me, unsubscribe here: " + unsubUrl;
  const openLine = "Hi,\n\nI'm Olly, I build Macrosaurus. ";
  let subject: string, body: string;
  if (variant === "setup") {
    subject = "Did something get in the way?";
    body = openLine + "I noticed you signed up a few days ago but didn't get through setting up, " +
      "and I'd really like to know why.\n\n" +
      "Was it too long, confusing, asking for something you didn't want to share, or just not what you expected? " +
      "Even a one-line reply helps me fix it for the next person.\n\n" +
      "If you want to pick up where you left off, it's here: https://macrosaurus.com";
  } else if (variant === "never") {
    subject = "Quick question about Macrosaurus";
    body = openLine + "You set everything up a few days ago but haven't logged anything yet" +
      (buddy ? " (" + buddy + " is still waiting!)" : "") + ", so I wanted to ask: what got in the way?\n\n" +
      "Couldn't find your foods, logging felt like too much effort, not sure where to start, or something else? " +
      "Just hit reply. I read every one, and it goes straight to me.\n\n" +
      "If you fancy giving it a go, logging one meal is the best place to start: https://macrosaurus.com/?action=log";
  } else {
    subject = "How did Macrosaurus go?";
    body = openLine + "You gave the app a try recently and then it went quiet, which is completely fine, " +
      "but I'd love to know what didn't click.\n\n" +
      "Was there something missing, something annoying, or did it just not fit your day? " +
      "Hit reply and tell me straight, good or bad. It goes to me, not a support queue.\n\n" +
      "And if you just got busy, it's all still there: https://macrosaurus.com";
  }
  return { variant, subject, text: body + sign + footer };
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
