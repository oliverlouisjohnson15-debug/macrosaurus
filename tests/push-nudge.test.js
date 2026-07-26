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
  assert.match(n.title, /3-day streak/);
  assert.strictEqual(n.url, '/?action=log');
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
  assert.strictEqual(n.url, '/?action=weigh');
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
