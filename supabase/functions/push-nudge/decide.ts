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
 *   3. weigh        - a morning window, and their cadence says a weigh-in is due today
 *   4. peckish      - nothing logged today (the original nudge)
 *   5. check-in     - logged fine, but the weekly read is well overdue
 *
 * Kept free of Deno and npm imports so index.ts can import it in the edge runtime and
 * tests/push-nudge.test.js can import the very same file under node --experimental-strip-types.
 * Pure: no clock, no network, no database. The caller passes the local date and which window is open.
 */
export const STREAK_SAVE_HOUR = 20;      // local hour for the evening streak-save window
export const STREAK_SAVE_MIN = 2;        // a 1-day "streak" is not yet worth protecting
export const CHECKIN_OVERDUE_DAYS = 8;   // the app asks at 5; push waits longer before interrupting
export const WEIGH_MORNING_END = 12;     // a weigh-in push is only honest before the day's food
export const WEIGH_GAP_DAYS = 2;         // a most-days weigher is only chased once a gap has opened
export const WEIGH_WEEKLY_GRACE = 8;     // a weekly weigher who missed their day, asked again after this

export type Nudge = { kind: string; title: string; body: string; url: string };
// `hour` is the subscriber's LOCAL hour, needed by the morning-only weigh nudge. Older callers that
// omit it simply never send that one.
export type Windows = { normal: boolean; streakSave: boolean; hour?: number };

export function isoShift(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

// Consecutive ACTIVE days (food logged OR weighed OR trained) ending today. A deliberately simple mirror of
// Game.computeStreak: it counts already-recorded freezes as active but never applies a NEW one, so
// where the two differ this reads SHORTER than the app's streak. That errs toward staying quiet,
// which is the right direction for something that buzzes a phone.
// A declared window the user told us about at check-in: a holiday, an illness, a flat-out week.
// The phone must respect these or the app going quiet is worthless, because the buzzing is the bit
// people actually feel.
type WeekPlan = { start?: string; end?: string; data?: string; label?: string };
export function weekPlanOn(d: Record<string, unknown>, iso: string): WeekPlan | null {
  const rows = d.week_plans;
  if (!Array.isArray(rows)) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const w = rows[i] as WeekPlan;
    if (w && w.start && w.end && iso >= w.start && iso <= w.end) return w;
  }
  return null;
}
// Days inside a declared window stop a run breaking, but do NOT earn streak days of their own:
// awarding them would pay people to declare holidays. Mirrors the app's rule exactly.
export function plannedDays(d: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const rows = d.week_plans;
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const w = r as WeekPlan;
    if (!w || !w.start || !w.end) continue;
    let day = w.start;
    for (let n = 0; day <= w.end && n < 400; n++) { out.add(day); day = isoShift(day, 1); }
  }
  return out;
}
export function activeStreak(d: Record<string, unknown>, today: string): number {
  const active = new Set<string>();
  const add = (rows: unknown, key: string) => {
    if (Array.isArray(rows)) for (const r of rows) { const v = (r as Record<string, string>)?.[key]; if (v) active.add(v); }
  };
  add(d.log_entries, "date");
  add(d.weight_entries, "date");
  // A logged training session is an active day too, exactly as in the app (trainedDates in
  // app/src/app.jsx). If the two ever disagree, this one sends a "your streak is about to break"
  // push to somebody whose streak the app can see is perfectly safe, which is the worst push we
  // could possibly send: wrong, and wrong about the day they worked hardest.
  add((d.training as { logs?: unknown } | undefined)?.logs, "dateISO");
  // Bridge planned days so a declared trip cannot snap the run, without counting toward it.
  const planned = plannedDays(d);
  const frozen = (d.freezes as { frozen?: string[] } | undefined)?.frozen;
  if (Array.isArray(frozen)) for (const f of frozen) if (f) active.add(f);
  let day = active.has(today) ? today : isoShift(today, -1);
  let n = 0;
  while ((active.has(day) || planned.has(day)) && n < 400) {
    if (active.has(day)) n++;              // planned days bridge the run, they do not extend it
    day = isoShift(day, -1);
  }
  return n;
}

// Rotate a line by date so a daily nudge never reads like the same robotic reminder. The buddy speaks
// in the first person throughout, in the app's copy voice: warm, British, no em dashes.
export function pick(lines: string[], date: string): string {
  const n = parseInt(String(date).replace(/-/g, "").slice(-3), 10) || 0;
  return lines[n % lines.length];
}

export function weekdayOf(iso: string): number {
  return new Date(iso + "T00:00:00Z").getUTCDay();
}

// The latest date with a scale reading, or null. Weigh entries are stored oldest-first but a scan
// costs nothing and does not depend on that holding.
export function lastWeighISO(d: Record<string, unknown>): string | null {
  const rows = d.weight_entries;
  if (!Array.isArray(rows)) return null;
  let latest: string | null = null;
  for (const r of rows as { date?: string; scale_weight?: number }[]) {
    if (r && r.date && r.scale_weight != null && (latest == null || r.date > latest)) latest = r.date;
  }
  return latest;
}

// Is a weigh-in worth a push this morning? Deliberately narrower than the in-app ask (app/game.js
// weighDue), which can afford to prompt every morning because it is sitting there waiting rather
// than buzzing a phone. Push only earns the interruption when:
//   - a once-a-week weigher is on the day they chose (or has drifted past the grace window), or
//   - a most-days weigher has actually gone quiet for a couple of days.
// A regular daily weigher therefore keeps getting the ordinary "what needs doing" nudge, not a
// scale reminder they were about to act on anyway.
export function weighPushDue(d: Record<string, unknown>, today: string, hour?: number): "weekly" | "gap" | null {
  if (hour == null || hour >= WEIGH_MORNING_END) return null;
  const weighedToday = Array.isArray(d.weight_entries)
    && (d.weight_entries as { date?: string }[]).some((w) => w && w.date === today);
  if (weighedToday) return null;
  const profile = (d.profile || {}) as { weighCadence?: string; weighDay?: number };
  const last = lastWeighISO(d);
  const since = last ? daysBetween(last, today) : null;
  if (profile.weighCadence === "single") {
    if (profile.weighDay != null && weekdayOf(today) === Number(profile.weighDay)) return "weekly";
    return (since == null || since >= WEIGH_WEEKLY_GRACE) ? "gap" : null;
  }
  return (since != null && since >= WEIGH_GAP_DAYS) ? "gap" : null;
}

export function decideNudge(d: Record<string, unknown>, today: string, win: Windows): Nudge | null {
  if (d.paused) return null;                       // a paused goal should never be chased
  // Inside a declared window we asked for this information and promised to act on it. Chasing a
  // weigh-in or a log from someone who told us they are away is the fastest way to teach them the
  // app is not listening, and a push is far harder to ignore than an in-app card.
  const away = weekPlanOn(d, today);
  if (away) {
    const off = away.data === "sparse" || away.data === "none";
    if (off) return null;                          // scale and log both left at home: total silence
    if (away.data === "rough" && win.streakSave) return null;  // no midnight alarm on a flat-out week
  }
  const buddy = (d.buddy || {}) as { name?: string; hatched?: boolean };
  const who = buddy.name ? String(buddy.name).slice(0, 24) : "Rex";
  const loggedToday = Array.isArray(d.log_entries)
    && (d.log_entries as { date?: string }[]).some((e) => e && e.date === today);
  const weighedToday = Array.isArray(d.weight_entries)
    && (d.weight_entries as { date?: string }[]).some((w) => w && w.date === today);
  // Somebody who trained today has done the hardest thing anyone does all day. Buzzing their phone
  // at 8pm to say their streak is at risk would be both wrong and insulting.
  const trainedToday = Array.isArray((d.training as { logs?: unknown[] } | undefined)?.logs)
    && ((d.training as { logs: { dateISO?: string }[] }).logs).some((l) => l && l.dateISO === today);

  // 1. Streak-save. The one push worth a second slot in the day: loss aversion, with the number in it.
  if (win.streakSave && !loggedToday && !weighedToday && !trainedToday) {
    const streak = activeStreak(d, today);
    if (streak >= STREAK_SAVE_MIN) {
      return {
        kind: "streaksave",
        // A notification cannot be un-read, which makes this the highest-guilt surface in the product
        // and the one furthest from how the buddy is supposed to speak. It used to lead with "your
        // streak is at risk", tell people not to break the chain, and say "I have been counting" -
        // loss framing, delivered uninvited, from a companion admitting it keeps score. The streak is
        // still worth mentioning; it is not worth weaponising. Every line now ends somewhere the
        // reader is allowed to do nothing.
        title: who + " is still up",
        body: pick([
          "Anything logged tonight and our " + streak + " days carry on. A weight or a session counts too.",
          "No rush, but I am still awake. One quick log and we keep going.",
          "Nothing yet today. Anything at all does it, and I will be here either way.",
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

  // 3. The morning weigh-in. Above the food nudge on purpose: the reading is only honest before the
  //    day's first food or drink, so if this one waits its turn it is already too late to be useful.
  const weighDue = weighPushDue(d, today, win.hour);
  if (weighDue) {
    return {
      kind: "weigh",
      title: weighDue === "weekly" ? "Weigh-in day" : who + " needs a weigh-in",
      body: weighDue === "weekly"
        ? pick([
          "It is your weigh-in morning. Hop on the scales before breakfast and I will read your trend.",
          "Weigh-in day! One number before food or drink and your plan stays tuned to the real you.",
        ], today)
        : pick([
          "Your trend has gone quiet. A weigh-in this morning and I can keep your targets honest.",
          "No weigh-in for a bit. Step on before breakfast and I will pick the trend back up.",
        ], today),
      url: "/?action=weigh",
    };
  }

  // 4. Nothing logged today: the original nudge, unchanged in spirit.
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

  // 5. Eating fine, but the weekly read is overdue. This is the one nudge that can reach someone who
  //    HAS logged, which is exactly why it waits longer than the in-app ask before interrupting.
  const last = typeof d.last_checkin === "string" ? d.last_checkin : null;
  if (last && daysBetween(last, today) >= CHECKIN_OVERDUE_DAYS) {
    // Someone who weighs once a week is being asked for the reading itself, so the nudge opens the
    // weigh sheet. Someone who weighs most mornings has already given us the week, so asking them to
    // "weigh in" is asking for something they have done six times: send them to the read instead.
    const single = ((d.profile || {}) as { weighCadence?: string }).weighCadence === "single";
    return {
      kind: "checkin",
      title: "Time for our check-in",
      body: single
        ? pick([
          "It has been a while since we read your trend. Hop on the scales and I will retune your targets.",
          "Your plan is due a tune-up. This week's weigh-in is all I need to sort it.",
        ], today)
        : pick([
          "I have got your weigh-ins already. Come and see what they say about your targets.",
          "Your plan is due a tune-up, and your trend is sitting here waiting to be read.",
        ], today),
      url: single ? "/?action=weigh" : "/?action=checkin",
    };
  }
  return null;
}
