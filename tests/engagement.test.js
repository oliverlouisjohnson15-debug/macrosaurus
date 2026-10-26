'use strict';
// Tests for supabase/functions/admin-api/engagement.ts: the per-account usage summary behind the
// admin Retention tab. The point of that tab is to find where new accounts stop, so the cases that
// matter most are the ones that could misfile someone: a synced step count reading as activity, a
// deleted entry still counting, a week-two window marked as a miss before it has happened.
//
// The module is TypeScript because it ships to the Deno edge runtime; node strips the types for us.
const { test } = require('node:test');
const assert = require('node:assert');

let E;
test.before(async () => { E = await import('../supabase/functions/admin-api/engagement.ts'); });

const NOW = Date.parse('2026-10-26T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const signedUp = n => ({ created_at: new Date(NOW - n * 86400000).toISOString(), confirmed: true });
const prof = { goalType: 'cut' };

test('an unconfirmed account with nothing done is unconfirmed', () => {
  const e = E.summarise(null, { created_at: daysAgo(5), confirmed: false }, NOW);
  assert.strictEqual(e.status, 'unconfirmed');
  assert.strictEqual(e.activeDays, 0);
  assert.strictEqual(e.lastActive, null);
});

test('confirmed but never finished setup is no_profile', () => {
  assert.strictEqual(E.summarise({ profile: null }, signedUp(5), NOW).status, 'no_profile');
});

test('set up but never logged: new inside 48h, never_logged after', () => {
  assert.strictEqual(E.summarise({ profile: prof }, signedUp(1), NOW).status, 'new');
  assert.strictEqual(E.summarise({ profile: prof }, signedUp(3), NOW).status, 'never_logged');
});

test('active, at risk and churned follow the last active day', () => {
  const st = d => ({ profile: prof, log_entries: [{ id: 'a', date: daysAgo(d) }] });
  assert.strictEqual(E.summarise(st(2), signedUp(60), NOW).status, 'active');
  assert.strictEqual(E.summarise(st(14), signedUp(60), NOW).status, 'at_risk');
  assert.strictEqual(E.summarise(st(40), signedUp(60), NOW).status, 'churned');
});

test('food, weigh-ins, check-ins and workouts all count, and dates are de-duplicated', () => {
  const st = {
    profile: prof,
    log_entries: [{ id: 'a', date: daysAgo(3) }, { id: 'b', date: daysAgo(3) }],
    weight_entries: [{ id: 'w', date: daysAgo(2) }],
    checkins: [{ date: daysAgo(2) }],
    training: { logs: [{ id: 't', dateISO: daysAgo(1) }] },
  };
  const e = E.summarise(st, signedUp(10), NOW);
  assert.strictEqual(e.activeDays, 3);
  assert.deepStrictEqual([e.foodLogs, e.weighIns, e.checkins, e.workouts], [2, 1, 1, 1]);
  assert.strictEqual(e.lastActive, daysAgo(1));
  assert.strictEqual(e.firstActive, daysAgo(3));
  assert.strictEqual(e.daysToFirst, 7);
});

test('synced steps and sleep are not activity', () => {
  const st = { profile: prof, steps: { [daysAgo(0)]: 9000 }, sleep: { [daysAgo(0)]: { min: 420 } } };
  const e = E.summarise(st, signedUp(30), NOW);
  assert.strictEqual(e.activeDays, 0);
  assert.strictEqual(e.status, 'never_logged');
});

test('tombstoned entries do not count', () => {
  const st = { profile: prof, log_entries: [{ id: 'gone', date: daysAgo(1) }], deleted: { gone: 1 } };
  assert.strictEqual(E.summarise(st, signedUp(30), NOW).activeDays, 0);
});

test('logging without finishing setup still reads as active', () => {
  const st = { profile: null, log_entries: [{ id: 'a', date: daysAgo(1) }] };
  assert.strictEqual(E.summarise(st, signedUp(5), NOW).status, 'active');
});

test('retention windows are null until they close, then true or false', () => {
  // Signed up 3 days ago, logged only on the signup day: week 1 is still open, so unknown.
  const young = E.summarise({ profile: prof, log_entries: [{ id: 'a', date: daysAgo(3) }] }, signedUp(3), NOW);
  assert.strictEqual(young.wk1, null);
  assert.strictEqual(young.wk2, null);
  // Signed up 20 days ago, came back on day 2 and never again: kept week 1, lost week 2.
  const st = { profile: prof, log_entries: [{ id: 'a', date: daysAgo(20) }, { id: 'b', date: daysAgo(18) }] };
  const e = E.summarise(st, signedUp(20), NOW);
  assert.strictEqual(e.wk1, true);
  assert.strictEqual(e.wk2, false);
  assert.strictEqual(e.wk4, null);
  // A window that is still open but already hit is a known yes.
  const early = E.summarise({ profile: prof, log_entries: [{ id: 'a', date: daysAgo(1) }] }, signedUp(3), NOW);
  assert.strictEqual(early.wk1, true);
});

test('a future-dated entry does not make someone look active', () => {
  const st = { profile: prof, log_entries: [{ id: 'a', date: '2027-03-01' }] };
  assert.strictEqual(E.summarise(st, signedUp(30), NOW).activeDays, 0);
});

test('last7 and last30 count active days in their windows', () => {
  const st = { profile: prof, log_entries: [0, 3, 6, 7, 20, 40].map((d, i) => ({ id: 'e' + i, date: daysAgo(d) })) };
  const e = E.summarise(st, signedUp(60), NOW);
  assert.strictEqual(e.last7, 3);
  assert.strictEqual(e.last30, 5);
});

test('recentStrip marks active days oldest first, ending today', () => {
  const st = { log_entries: [{ id: 'a', date: daysAgo(0) }, { id: 'b', date: daysAgo(34) }] };
  const r = E.recentStrip(st, NOW);
  assert.strictEqual(r.days.length, 35);
  assert.strictEqual(r.start, daysAgo(34));
  assert.strictEqual(r.days[0], 1);
  assert.strictEqual(r.days[34], 1);
  assert.strictEqual(r.days.reduce((a, b) => a + b, 0), 2);
});
