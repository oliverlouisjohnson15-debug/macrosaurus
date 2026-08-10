'use strict';
// Tests for the push ladder in supabase/functions/push-nudge/decide.ts: which nudge (if any) the
// buddy sends, in which window. This decides whether we buzz someone's phone, so the "stays silent"
// cases matter at least as much as the "sends" ones.
//
// The module is TypeScript because it ships to the Deno edge runtime; node strips the types for us.
// Run with:  npm test   (the script passes --experimental-strip-types)
const { test } = require('node:test');
const assert = require('node:assert');

const NORMAL = { normal: true, streakSave: false };
const EVENING = { normal: false, streakSave: true };
const TODAY = '2026-07-26';
const days = (...ds) => ds.map(d => ({ date: d }));

// Dynamic import (the module is ESM TypeScript); the result is cached, so every test can just await
// it rather than depending on a load test having run first.
const load = () => import('../supabase/functions/push-nudge/decide.ts');

// ---- Silence: the cases where nothing should reach the phone ----

test('a paused goal is never chased, in either window', async () => {
  const st = { paused: true, log_entries: [] };
  assert.strictEqual((await load()).decideNudge(st, TODAY, NORMAL), null);
  assert.strictEqual((await load()).decideNudge(st, TODAY, EVENING), null);
});

test('nothing is sent outside both windows', async () => {
  assert.strictEqual((await load()).decideNudge({ log_entries: [] }, TODAY, { normal: false, streakSave: false }), null);
});

test('someone who logged today and is up to date hears nothing', async () => {
  const st = { log_entries: days(TODAY), last_checkin: '2026-07-24' };
  assert.strictEqual((await load()).decideNudge(st, TODAY, NORMAL), null);
});

test('the evening window stays quiet once the day is already active', async () => {
  const streak = { log_entries: days('2026-07-23', '2026-07-24', '2026-07-25', TODAY) };
  assert.strictEqual((await load()).decideNudge(streak, TODAY, EVENING), null);
  // A weigh-in counts as activity just like a food log, so it also silences the streak-save.
  const weighed = { log_entries: days('2026-07-24', '2026-07-25'), weight_entries: days(TODAY) };
  assert.strictEqual((await load()).decideNudge(weighed, TODAY, EVENING), null);
});

test('the evening window stays quiet when there is no run worth protecting', async () => {
  assert.strictEqual((await load()).decideNudge({ log_entries: [] }, TODAY, EVENING), null);              // no streak
  assert.strictEqual((await load()).decideNudge({ log_entries: days('2026-07-25') }, TODAY, EVENING), null); // only 1 day
});

// ---- The ladder ----

test('streak-save fires in the evening with a run on the line, and names the number', async () => {
  const st = { log_entries: days('2026-07-23', '2026-07-24', '2026-07-25') };
  const n = (await load()).decideNudge(st, TODAY, EVENING);
  assert.strictEqual(n.kind, 'streaksave');
  // The run is still named, in the body rather than the headline. The title used to lead with
  // "your 3-day streak is at risk"; a lock screen is the one surface the reader cannot dismiss,
  // so the number arrives as context rather than as the threat.
  assert.match(n.body, /3 days/);
  assert.strictEqual(n.url, '/?action=log');
});

test('streak-save never uses loss framing or admits to keeping score', async () => {
  const st = { log_entries: days('2026-07-23', '2026-07-24', '2026-07-25') };
  const d = await load();
  // Every rotation of the body, not just today's pick, so a line cannot regress unseen.
  const back = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };
  const seen = new Set();
  for (const day of ['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30']) {
    const st2 = { log_entries: days(back(day, 3), back(day, 2), back(day, 1)) };
    const n = d.decideNudge(st2, day, EVENING);
    if (n && n.kind === 'streaksave') seen.add(n.title + ' | ' + n.body);
  }
  const banned = /at risk|do not break|don'?t break|breaking|lose|losing|last chance|counting/i;
  for (const line of seen) assert.ok(!banned.test(line), 'loss framing in push copy: ' + line);
  assert.ok(seen.size >= 2, 'expected the body to rotate, got ' + seen.size);
});

test('an incubating egg gets hatch copy, not "peckish"', async () => {
  const st = { buddy: { hatched: false }, log_entries: [] };
  const n = (await load()).decideNudge(st, TODAY, NORMAL);
  assert.strictEqual(n.kind, 'hatch');
  assert.match(n.title, /egg/i);
});

test('an unlogged day gets the peckish nudge, in the buddy\'s name', async () => {
  const n = (await load()).decideNudge({ buddy: { name: 'Chompers' }, log_entries: [] }, TODAY, NORMAL);
  assert.strictEqual(n.kind, 'peckish');
  assert.match(n.title, /^Chompers is peckish$/);
});

test('an overdue check-in reaches someone who HAS logged', async () => {
  // The one nudge that can interrupt a compliant user, so it waits longer than the in-app ask.
  const st = { log_entries: days(TODAY), last_checkin: '2026-07-18' }; // 8 days
  const n = (await load()).decideNudge(st, TODAY, NORMAL);
  assert.strictEqual(n.kind, 'checkin');
  // Daily weigher: their week is already on record, so the push opens the read, not the scales.
  assert.strictEqual(n.url, '/?action=checkin');
  assert.match(n.body, /already|waiting/i);
  // Once-a-week weigher: the reading IS the check-in, so it still opens the weigh sheet.
  const weekly = (await load()).decideNudge(Object.assign({ profile: { weighCadence: 'single' } }, st), TODAY, NORMAL);
  assert.strictEqual(weekly.kind, 'checkin');
  assert.strictEqual(weekly.url, '/?action=weigh');
  assert.match(weekly.body, /scales|weigh-in/i);
  // A day earlier it is not yet overdue.
  assert.strictEqual((await load()).decideNudge({ log_entries: days(TODAY), last_checkin: '2026-07-19' }, TODAY, NORMAL), null);
});

test('not-logged outranks an overdue check-in: one voice, the most useful thing only', async () => {
  const st = { log_entries: [], last_checkin: '2026-06-01' };
  assert.strictEqual((await load()).decideNudge(st, TODAY, NORMAL).kind, 'peckish');
});

test('a user who never checked in is not chased about it', async () => {
  assert.strictEqual((await load()).decideNudge({ log_entries: days(TODAY) }, TODAY, NORMAL), null);
});

// ---- activeStreak: the count behind the streak-save ----

test('activeStreak counts back over logs, weigh-ins and recorded freezes', async () => {
  assert.strictEqual((await load()).activeStreak({ log_entries: days('2026-07-25', '2026-07-24') }, TODAY), 2);
  // Yesterday logged, the day before covered by a weigh-in, the one before by a freeze.
  const mixed = {
    log_entries: days('2026-07-25'),
    weight_entries: days('2026-07-24'),
    freezes: { frozen: ['2026-07-23'] },
    };
  assert.strictEqual((await load()).activeStreak(mixed, TODAY), 3);
});

test('activeStreak stops at the first genuine gap', async () => {
  assert.strictEqual((await load()).activeStreak({ log_entries: days('2026-07-25', '2026-07-23', '2026-07-22') }, TODAY), 1);
});

test('activeStreak counts today when today is already active', async () => {
  assert.strictEqual((await load()).activeStreak({ log_entries: days(TODAY, '2026-07-25') }, TODAY), 2);
});

test('activeStreak is 0 with nothing recorded', async () => {
  assert.strictEqual((await load()).activeStreak({}, TODAY), 0);
});

// ---- Copy discipline: the house voice, enforced ----

test('every line the buddy can send is in house style', async () => {
  const cases = [
    [{ log_entries: [] }, NORMAL],
    [{ buddy: { hatched: false }, log_entries: [] }, NORMAL],
    [{ log_entries: days(TODAY), last_checkin: '2026-01-01' }, NORMAL],
    [{ log_entries: days('2026-07-25', '2026-07-24') }, EVENING],
    [{ profile: { weighCadence: 'single', weighDay: 0 }, log_entries: [], weight_entries: [{ date: '2026-07-19', scale_weight: 80 }] }, { normal: true, streakSave: false, hour: 8 }],
    [{ profile: { weighCadence: 'daily' }, log_entries: [], weight_entries: [{ date: '2026-07-20', scale_weight: 80 }] }, { normal: true, streakSave: false, hour: 8 }],
  ];
  // Rotate through a month of dates so every line in every pool is covered, not just today's.
  for (let day = 1; day <= 28; day++) {
    const date = '2026-07-' + String(day).padStart(2, '0');
    for (const [st, win] of cases) {
      const n = (await load()).decideNudge(st, date, win);
      if (!n) continue;
      assert.ok(!/[—–]/.test(n.body + n.title), 'em dash in: ' + n.body);
      assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(n.body + n.title), 'emoji in: ' + n.body);
      assert.ok(n.body.length > 0 && n.body.length <= 140, 'body length ' + n.body.length + ': ' + n.body);
      assert.ok(n.url.startsWith('/?action='), 'bad url: ' + n.url);
    }
  }
});

// ---- The morning weigh-in: the buddy asking for a number on the right day ----
// TODAY (2026-07-26) is a Sunday, so weighDay 0 is 'today' and weighDay 1 is 'tomorrow'.
const MORNING = { normal: true, streakSave: false, hour: 8 };
const AFTERNOON = { normal: true, streakSave: false, hour: 15 };
const weighed = (...ds) => ds.map(d => ({ date: d, scale_weight: 80 }));

test('a weekly weigher is asked on the day they picked, ahead of the food nudge', async () => {
  // Sunday, cadence single, weighDay 0 (Sunday), nothing logged: the weigh-in outranks "peckish"
  // because a scale reading is only honest before the day's first food.
  const st = { profile: { weighCadence: 'single', weighDay: 0 }, log_entries: [], weight_entries: weighed('2026-07-19') };
  const n = (await load()).decideNudge(st, TODAY, MORNING);
  assert.strictEqual(n.kind, 'weigh');
  assert.strictEqual(n.url, '/?action=weigh');
});

test('a weekly weigher hears nothing about weighing on the other six days', async () => {
  const st = { profile: { weighCadence: 'single', weighDay: 1 }, log_entries: days(TODAY), weight_entries: weighed('2026-07-25') };
  assert.strictEqual((await load()).decideNudge(st, TODAY, MORNING), null);
});

test('a regular daily weigher still gets the ordinary nudge, not a scale reminder', async () => {
  // Weighed yesterday, so there is no gap: the buddy has nothing new to say about the scales.
  const st = { profile: { weighCadence: 'daily' }, log_entries: [], weight_entries: weighed('2026-07-25') };
  assert.strictEqual((await load()).decideNudge(st, TODAY, MORNING).kind, 'peckish');
});

test('a daily weigher who has gone quiet for a couple of days is chased', async () => {
  const st = { profile: { weighCadence: 'daily' }, log_entries: days(TODAY), weight_entries: weighed('2026-07-23') };
  assert.strictEqual((await load()).decideNudge(st, TODAY, MORNING).kind, 'weigh');
});

test('no weigh nudge outside the morning, or when the hour is unknown', async () => {
  const st = { profile: { weighCadence: 'single', weighDay: 0 }, log_entries: days(TODAY), weight_entries: weighed('2026-07-19') };
  assert.strictEqual((await load()).decideNudge(st, TODAY, AFTERNOON), null);
  assert.strictEqual((await load()).decideNudge(st, TODAY, NORMAL), null);
});

test('no weigh nudge once today already has a reading', async () => {
  const st = { profile: { weighCadence: 'single', weighDay: 0 }, log_entries: days(TODAY), weight_entries: weighed(TODAY) };
  assert.strictEqual((await load()).decideNudge(st, TODAY, MORNING), null);
});

test('an egg still hears about hatching first', async () => {
  const st = { buddy: { hatched: false }, profile: { weighCadence: 'single', weighDay: 0 }, log_entries: [], weight_entries: [] };
  assert.strictEqual((await load()).decideNudge(st, TODAY, MORNING).kind, 'hatch');
});

// ---- Declared windows: the phone has to respect what the app was told ----
// The in-app buddy already goes quiet during a trip. If the phone keeps buzzing, the silence is
// worthless, because the push is the bit people actually feel.
const plan = (o) => Object.assign({
  id: 'p1', start: '2026-07-24', end: '2026-07-28', kind: 'travel', label: 'Travelling', data: 'sparse',
}, o);

test('silent through a window where the scale stayed at home', async () => {
  const { decideNudge } = await load();
  const state = { week_plans: [plan()], log_entries: [], weight_entries: [], buddy: { hatched: true, name: 'Rex' },
    profile: { weighCadence: 'daily' } };
  assert.equal(decideNudge(state, TODAY, { normal: true, streakSave: false, hour: 8 }), null, 'no morning weigh push');
  assert.equal(decideNudge(state, TODAY, NORMAL), null, 'no peckish push');
  assert.equal(decideNudge(state, TODAY, EVENING), null, 'no midnight streak alarm');
});

test('a flat-out week still gets the daytime nudge but never the midnight alarm', async () => {
  const { decideNudge } = await load();
  const state = { week_plans: [plan({ data: 'rough' })], log_entries: [], weight_entries: [],
    buddy: { hatched: true, name: 'Rex' }, profile: { weighCadence: 'daily' } };
  assert.equal(decideNudge(state, TODAY, EVENING), null, 'no streak-save alarm on a declared busy week');
  assert.ok(decideNudge(state, TODAY, NORMAL), 'but the ordinary daytime nudge still lands');
});

test('the day after a window closes, the phone speaks again', async () => {
  const { decideNudge } = await load();
  const state = { week_plans: [plan({ end: '2026-07-25' })], log_entries: [], weight_entries: [],
    buddy: { hatched: true, name: 'Rex' }, profile: { weighCadence: 'daily' } };
  assert.ok(decideNudge(state, TODAY, NORMAL), 'window ended yesterday, so normal service resumes');
});

test('planned days bridge a streak without inflating it', async () => {
  const { activeStreak } = await load();
  // Logged the 20th to the 23rd, away the 24th to the 25th, logged again on the 26th.
  const state = {
    log_entries: days('2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-26'),
    weight_entries: [],
    week_plans: [plan({ start: '2026-07-24', end: '2026-07-25' })],
  };
  // 5 real active days bridged across the trip: the run survives, but the trip earns nothing.
  assert.equal(activeStreak(state, TODAY), 5);
});

test('without the window, the same gap breaks the run', async () => {
  const { activeStreak } = await load();
  const state = {
    log_entries: days('2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-26'),
    weight_entries: [], week_plans: [],
  };
  assert.equal(activeStreak(state, TODAY), 1, 'only today survives');
});

// ---- a training session is an active day, on this side of the wire too ----
// The app counts a logged session toward the streak (trainedDates in app/src/app.jsx). If this file
// disagreed, we would buzz somebody's phone about a streak the app can see is perfectly safe, on the
// evening of the day they worked hardest. These are the tests that keep the two definitions honest.

const sessions = (...ds) => ({ logs: ds.map(d => ({ id: 'l' + d, dateISO: d })) });

test('activeStreak counts training sessions alongside logs and weigh-ins', async () => {
  const st = { log_entries: days('2026-07-25'), training: sessions('2026-07-24', '2026-07-23') };
  assert.strictEqual((await load()).activeStreak(st, TODAY), 3);
});

test('activeStreak survives a training slice that is absent or malformed', async () => {
  assert.strictEqual((await load()).activeStreak({ log_entries: days('2026-07-25'), training: {} }, TODAY), 1);
  assert.strictEqual((await load()).activeStreak({ log_entries: days('2026-07-25'), training: null }, TODAY), 1);
});

test('no streak-save push on an evening the session is already in', async () => {
  const st = { log_entries: days('2026-07-25', '2026-07-24', '2026-07-23'), training: sessions(TODAY) };
  assert.strictEqual((await load()).decideNudge(st, TODAY, EVENING), null);
});

test('the streak-save still fires on an evening with nothing at all in it', async () => {
  const st = { log_entries: days('2026-07-25', '2026-07-24', '2026-07-23') };
  const n = (await load()).decideNudge(st, TODAY, EVENING);
  assert.strictEqual(n && n.kind, 'streaksave');
});
