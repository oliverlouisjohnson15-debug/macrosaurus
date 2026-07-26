/*
 * decide.ts - What the buddy says over push, and whether it says anything at all.
 *
 * The in-app buddy speaks with one voice through a priority ladder (buddyMessage in
 * app/src/app.jsx): it works out the single most useful thing to say and says only that. Push used
 * to be a flat "you have not logged" reminder at one fixed hour, which meant the most valuable
 * thing the buddy knows, that a streak the user has built is hours from breaking, never reached
 * them. This is the same idea, server-side and deliberately much narrower: push is interruptive, so
 * only genuinely actionable things earn one and everything else stays silent.
 *
 * Order, most important first:
 *   1. streak-save  - a run of 2+ days with nothing logged or weighed, late in the evening
 *   2. hatch        - still incubating and nothing logged today
 *   3. peckish      - nothing logged today (the original nudge)
 *   4. check-in     - logged fine, but the weekly read is well overdue
 *
 * Kept free of Deno and npm imports so index.ts can import it in the edge runtime and
 * tests/push-nudge.test.js can import the very same file under node --experimental-strip-types.
 * Pure: no clock, no network, no database. The caller passes the local date and which window is open.
 */
export const STREAK_SAVE_HOUR = 20;      // local hour for the evening streak-save window
export const STREAK_SAVE_MIN = 2;        // a 1-day "streak" is not yet worth protecting
export const CHECKIN_OVERDUE_DAYS = 8;   // the app asks at 5; push waits longer before interrupting

export type Nudge = { kind: string; title: string; body: string; url: string };
export type Windows = { normal: boolean; streakSave: boolean };

export function isoShift(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

// Consecutive ACTIVE days (food logged OR weighed) ending today. A deliberately simple mirror of
// Game.computeStreak: it counts already-recorded freezes as active but never applies a NEW one, so
// where the two differ this reads SHORTER than the app's streak. That errs toward staying quiet,
// which is the right direction for something that buzzes a phone.
export function activeStreak(d: Record<string, unknown>, today: string): number {
  const active = new Set<string>();
  const add = (rows: unknown, key: string) => {
    if (Array.isArray(rows)) for (const r of rows) { const v = (r as Record<string, string>)?.[key]; if (v) active.add(v); }
  };
  add(d.log_entries, "date");
  add(d.weight_entries, "date");
  const frozen = (d.freezes as { frozen?: string[] } | undefined)?.frozen;
  if (Array.isArray(frozen)) for (const f of frozen) if (f) active.add(f);
  let day = active.has(today) ? today : isoShift(today, -1);
  let n = 0;
  while (active.has(day) && n < 400) { n++; day = isoShift(day, -1); }
  return n;
}

// Rotate a line by date so a daily nudge never reads like the same robotic reminder. The buddy speaks
// in the first person throughout, in the app's copy voice: warm, British, no em dashes.
export function pick(lines: string[], date: string): string {
  const n = parseInt(String(date).replace(/-/g, "").slice(-3), 10) || 0;
  return lines[n % lines.length];
}

export function decideNudge(d: Record<string, unknown>, today: string, win: Windows): Nudge | null {
  if (d.paused) return null;                       // a paused goal should never be chased
  const buddy = (d.buddy || {}) as { name?: string; hatched?: boolean };
  const who = buddy.name ? String(buddy.name).slice(0, 24) : "Rex";
  const loggedToday = Array.isArray(d.log_entries)
    && (d.log_entries as { date?: string }[]).some((e) => e && e.date === today);
  const weighedToday = Array.isArray(d.weight_entries)
    && (d.weight_entries as { date?: string }[]).some((w) => w && w.date === today);

  // 1. Streak-save. The one push worth a second slot in the day: loss aversion, with the number in it.
  if (win.streakSave && !loggedToday && !weighedToday) {
    const streak = activeStreak(d, today);
    if (streak >= STREAK_SAVE_MIN) {
      return {
        kind: "streaksave",
        title: "Your " + streak + "-day streak is at risk",
        body: pick([
          "Do not break the chain! Log anything before midnight and we keep the run going.",
          "There is still time. One quick log tonight and your " + streak + " days stay safe.",
          "I have been counting. Log something before bed and we carry on tomorrow.",
        ], today),
        url: "/?action=log",
      };
    }
    return null;                                    // nothing to protect, so stay quiet
  }
  if (!win.normal) return null;

  // 2. Still an egg: the payoff they are working toward is hatching, not growing.
  if (buddy.hatched === false) {
    if (loggedToday) return null;
    return {
      kind: "hatch",
      title: "Your egg is waiting",
      body: pick([
        "I am nearly ready to hatch. Log a meal and you will bring me out that bit sooner.",
        "Still curled up in here. A meal logged today gets me closer to meeting you.",
      ], today),
      url: "/?action=log",
    };
  }

  // 3. Nothing logged today: the original nudge, unchanged in spirit.
  if (!loggedToday) {
    return {
      kind: "peckish",
      title: who + " is peckish",
      body: pick([
        "I have not eaten yet today. Log a meal and I will grow a little stronger.",
        "Nothing logged yet. Pop your last meal in and I will do the maths for you.",
        "Feed me before the day slips away. A quick log keeps us both on track.",
      ], today),
      url: "/?action=log",
    };
  }

  // 4. Eating fine, but the weekly read is overdue. This is the one nudge that can reach someone who
  //    HAS logged, which is exactly why it waits longer than the in-app ask before interrupting.
  const last = typeof d.last_checkin === "string" ? d.last_checkin : null;
  if (last && daysBetween(last, today) >= CHECKIN_OVERDUE_DAYS) {
    return {
      kind: "checkin",
      title: "Time for our check-in",
      body: pick([
        "It has been a while since we read your trend. Weigh in and I will retune your targets.",
        "Your plan is due a tune-up. A quick weigh-in is all I need to sort it.",
      ], today),
      url: "/?action=weigh",
    };
  }
  return null;
}
