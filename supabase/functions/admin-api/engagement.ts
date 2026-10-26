/*
 * engagement.ts - How much an account has actually USED the app, read out of its synced state.
 *
 * The admin panel could already say who signed up and when they last signed in, but a session
 * token lives for weeks, so last_sign_in_at says almost nothing about whether someone is still
 * logging. The only honest signal is the work itself: the dates on food logs, weigh-ins, check-ins
 * and training sessions. This turns a user_state blob into a small summary of those dates, so the
 * panel can show where new accounts stop (never set up, never logged, logged once and left) without
 * shipping anyone's diary to the browser.
 *
 * Only dates and counts leave this module. No weights, no intake, no food names: the retention view
 * needs to know THAT someone logged, never WHAT.
 *
 * Steps, sleep and health are deliberately not activity. They arrive from a Google Health sync on
 * their own, so an account that connected once and never opened the app again would read as active
 * every day forever.
 *
 * Kept free of Deno and npm imports so index.ts can import it in the edge runtime and
 * tests/engagement.test.js can import the very same file under node --experimental-strip-types.
 * Pure: the caller passes "now".
 */

export const ACTIVE_DAYS = 7;    // active within this many days -> 'active'
export const CHURN_DAYS = 21;    // nothing for longer than this -> 'churned'; in between -> 'at_risk'
export const NEW_HOURS = 48;     // a brand-new account with nothing logged yet is 'new', not a drop-off
export const RECENT_WINDOW = 35; // how many days of the activity strip get_user returns

export type Status = 'unconfirmed' | 'no_profile' | 'new' | 'never_logged' | 'active' | 'at_risk' | 'churned';

export interface Engagement {
  status: Status;
  activeDays: number;          // distinct dates with any activity
  firstActive: string | null;  // YYYY-MM-DD
  lastActive: string | null;
  daysSinceActive: number | null;
  daysToFirst: number | null;  // signup day -> first active day
  foodLogs: number;
  weighIns: number;
  checkins: number;
  workouts: number;
  // Came back in a window measured from the signup day: week 1 is days 1-6 (day 0 is the signup day
  // itself, which every activated user has), week 2 is days 7-13, week 4 is days 28-34. Null when
  // the account is too young for the window to have closed, so a cohort is never marked down for a
  // week its newest users have not lived through yet.
  wk1: boolean | null;
  wk2: boolean | null;
  wk4: boolean | null;
  last7: number;               // active days in the last 7
  last30: number;              // active days in the last 30
}

const DAY = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayIndex = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY);
const isoOf = (idx: number) => new Date(idx * DAY).toISOString().slice(0, 10);

// Every distinct date the user did something, honouring deletion tombstones the same way the client
// merge does (Store.mergeStates drops any entry whose id is in `deleted`).
export function activeDates(state: any): { dates: Set<string>; foodLogs: number; weighIns: number; checkins: number; workouts: number } {
  const s = state || {};
  const del = (s.deleted && typeof s.deleted === 'object') ? s.deleted : {};
  const alive = (arr: any) => (Array.isArray(arr) ? arr : []).filter((e: any) => e && !(e.id != null && del[e.id]));
  const dates = new Set<string>();
  const add = (d: any) => { if (typeof d === 'string' && ISO.test(d.slice(0, 10))) dates.add(d.slice(0, 10)); };
  const logs = alive(s.log_entries); logs.forEach((e: any) => add(e.date));
  const weights = alive(s.weight_entries); weights.forEach((e: any) => add(e.date));
  const checks = (Array.isArray(s.checkins) ? s.checkins : []).filter(Boolean); checks.forEach((e: any) => add(e.date));
  const sessions = alive(s.training && s.training.logs); sessions.forEach((e: any) => add(e.dateISO));
  return { dates, foodLogs: logs.length, weighIns: weights.length, checkins: checks.length, workouts: sessions.length };
}

export function summarise(
  state: any,
  user: { created_at?: string | null; confirmed?: boolean },
  now: number,
): Engagement {
  const { dates, foodLogs, weighIns, checkins, workouts } = activeDates(state);
  const today = Math.floor(now / DAY);
  // A date in the future is a clock or timezone artefact; it must not make someone look active.
  const idx = Array.from(dates).map(dayIndex).filter(i => isFinite(i) && i <= today + 1).sort((a, b) => a - b);
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  const signup = isFinite(created) ? Math.floor(created / DAY) : (idx.length ? idx[0] : today);
  const age = today - signup;

  const first = idx.length ? idx[0] : null;
  const last = idx.length ? idx[idx.length - 1] : null;
  const since = last == null ? null : Math.max(0, today - last);
  const inWindow = (lo: number, hi: number) => idx.some(i => i - signup >= lo && i - signup <= hi);
  // A window counts once it has fully closed; until then it is unknown, not a miss.
  const win = (lo: number, hi: number) => (age > hi ? inWindow(lo, hi) : (inWindow(lo, hi) ? true : null));

  let status: Status;
  if (user.confirmed === false) status = 'unconfirmed';
  else if (!state || !state.profile) status = 'no_profile';
  else if (last == null) status = isFinite(created) && now - created < NEW_HOURS * 3600000 ? 'new' : 'never_logged';
  else if (since! <= ACTIVE_DAYS) status = 'active';
  else if (since! <= CHURN_DAYS) status = 'at_risk';
  else status = 'churned';
  // Someone who skipped confirmation or setup but is logging anyway is simply active; what they
  // did matters more than which box they left unticked.
  if ((status === 'unconfirmed' || status === 'no_profile') && last != null) {
    status = since! <= ACTIVE_DAYS ? 'active' : since! <= CHURN_DAYS ? 'at_risk' : 'churned';
  }

  return {
    status,
    activeDays: idx.length,
    firstActive: first == null ? null : isoOf(first),
    lastActive: last == null ? null : isoOf(last),
    daysSinceActive: since,
    daysToFirst: first == null ? null : Math.max(0, first - signup),
    foodLogs, weighIns, checkins, workouts,
    wk1: win(1, 6),
    wk2: win(7, 13),
    wk4: win(28, 34),
    last7: idx.filter(i => today - i < 7).length,
    last30: idx.filter(i => today - i < 30).length,
  };
}

// The last RECENT_WINDOW days as a 0/1 strip, oldest first, for the per-user activity grid.
export function recentStrip(state: any, now: number, days = RECENT_WINDOW): { start: string; days: number[] } {
  const { dates } = activeDates(state);
  const today = Math.floor(now / DAY);
  const start = today - days + 1;
  const out: number[] = [];
  for (let i = start; i <= today; i++) out.push(dates.has(isoOf(i)) ? 1 : 0);
  return { start: isoOf(start), days: out };
}
