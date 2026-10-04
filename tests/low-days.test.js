'use strict';
/* Low days, alongside high days.
 *
 * The weekly shape could only ever make a day BIG: tap Saturday and every other day came down to pay
 * for it. What people actually run - and what MacroFactor's calorie shifting lets you mark - is a
 * week of three kinds of day: the big ones, the rest days that pay for them, and the ordinary days
 * that are left alone. These pin the arithmetic (the week always nets to base, nothing goes through
 * the floor) and the tap that steps a day through the three.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');
const { app, render } = require('./helpers/app.js');

const A = app();
const week = (cfg, base, floor) => [0, 1, 2, 3, 4, 5, 6].map(d => E.cyclingDelta(cfg, d, base, floor));
const sum = a => a.reduce((x, y) => x + y, 0);

test('high days only: unchanged, every other day pays', () => {
  const w = week({ enabled: true, highDays: [6], deltaPct: 0.15 }, 2000);
  assert.deepStrictEqual(w, [-50, -50, -50, -50, -50, -50, 300]);
  // A plan saved before low days existed, and one with an empty list, read the same.
  assert.deepStrictEqual(week({ enabled: true, highDays: [6], lowDays: [], deltaPct: 0.15 }, 2000), w);
});

test('high and low days: the low days pay, the normal days stay on base', () => {
  // Sat high, Sun and Wed low.
  const w = week({ enabled: true, highDays: [6], lowDays: [0, 3], deltaPct: 0.15 }, 2000);
  assert.deepStrictEqual(w, [-150, 0, 0, -150, 0, 0, 300]);
  assert.strictEqual(sum(w), 0);
});

test('low days only: they come down, and the normal days take what they save', () => {
  const w = week({ enabled: true, highDays: [], lowDays: [0, 6], deltaPct: 0.15 }, 2000);
  assert.deepStrictEqual(w, [-300, 120, 120, 120, 120, 120, -300]);
  assert.strictEqual(sum(w), 0);
  // Seven low days have nobody to hand it to.
  assert.deepStrictEqual(week({ enabled: true, lowDays: [0, 1, 2, 3, 4, 5, 6], deltaPct: 0.15 }, 2000), [0, 0, 0, 0, 0, 0, 0]);
});

test('a low day stops at the floor and the normal days pick up the rest', () => {
  // Four high days at +15% owe 1200; one low day can only give 400 before 1600 hits a 1200 floor.
  const cfg = { enabled: true, highDays: [1, 2, 4, 5], lowDays: [0], deltaPct: 0.15 };
  const w = week(cfg, 1600, 1200);
  assert.strictEqual(w[0], -400, 'the low day lands on the floor, not through it');
  assert.ok(w[3] < 0 && w[6] < 0, 'the normal days cover what the low day could not');
  assert.ok(Math.abs(sum(w)) <= 2, 'and the week still nets to base: ' + w.join(', '));
  w.forEach(d => assert.ok(1600 + d >= 1200, 'no day below the floor: ' + w.join(', ')));
});

test('a day in both lists is high', () => {
  const w = week({ enabled: true, highDays: [6], lowDays: [6, 0], deltaPct: 0.15 }, 2000);
  assert.strictEqual(w[6], 300);
  assert.strictEqual(w[0], -300);
});

test('the low-day cut is floor-clamped too', () => {
  const w = week({ enabled: true, lowDays: [0], deltaPct: 0.3 }, 1400, 1200);
  assert.strictEqual(w[0], -200);
  assert.ok(Math.abs(sum(w)) <= 3);
});

test('tapping a day steps it normal, high, low, normal', () => {
  const J = x => JSON.parse(JSON.stringify(x));   // the app lives in its own realm
  let c = { enabled: false, highDays: [6], lowDays: [], deltaPct: 0.15 };   // the default profile's stale Saturday
  c = Object.assign({}, c, A.nextDayKind(c, 6));
  assert.deepStrictEqual(J([c.enabled, c.highDays, c.lowDays]), [true, [6], []], 'a switched-off plan starts from even');
  c = Object.assign({}, c, A.nextDayKind(c, 6));
  assert.deepStrictEqual(J([c.highDays, c.lowDays]), [[], [6]]);
  c = Object.assign({}, c, A.nextDayKind(c, 6));
  assert.deepStrictEqual(J([c.enabled, c.highDays, c.lowDays]), [false, [], []]);
});

test('a week with a low day is Custom, and Even clears it', () => {
  assert.strictEqual(A.activePresetOf({ enabled: true, highDays: [0, 6], lowDays: [3] }), 'custom');
  assert.strictEqual(A.activePresetOf({ enabled: true, highDays: [0, 6], lowDays: [] }), 'weekend');
  assert.strictEqual(A.activePresetOf({ enabled: true, highDays: [], lowDays: [] }), 'even');
});

test('a low day is dated like any other change to the plan', () => {
  const db = A.Store.defaultState();
  const today = A.Store.todayISO();
  db.profile = Object.assign({}, db.profile, { sex: 'male', age: 32, heightCm: 178, weightKg: 84, goalType: 'cut', rateKgPerWeek: 0.5,
    cycling: { enabled: true, highDays: [6], lowDays: [], deltaPct: 0.15 } });
  db.targets = [{ id: 't1', effective_date: A.shiftISO(today, -30), kcal: 2000, protein_g: 160, carbs_g: 200, fat_g: 65 }];
  const pend = A.pendingCyclingChange(db, { enabled: true, highDays: [6], lowDays: [0], deltaPct: 0.15 }, today, today);
  assert.ok(pend, 'adding a low day is a change');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pend.entry.lowDays)), [0]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pend.history[0].lowDays)), [], 'the outgoing plan is recorded without it');
});

test('the strip labels each day and the low days read as low', () => {
  const db = A.Store.defaultState();
  const today = A.Store.todayISO();
  db.profile = Object.assign({}, db.profile, {
    sex: 'male', age: 32, heightCm: 178, weightKg: 84, bodyFatPct: 22, activityLevel: 'moderate', goalType: 'cut',
    rateKgPerWeek: 0.5, dietStyle: 'balanced', carryover: { enabled: false, mode: 'dispersed', capKcal: 400 },
    cycling: { enabled: true, highDays: [6], lowDays: [0, 3], deltaPct: 0.15 },
  });
  db.targets = [{ id: 't1', effective_date: A.shiftISO(today, -30), kcal: 2000, protein_g: 160, carbs_g: 200, fat_g: 65 }];
  db.last_checkin = today;
  const r = render(A.WeeklyShapeScreen, { db, update() {}, onBack() {}, onOpen() {} });
  const lows = (r.html.match(/, low day"/g) || []).length;
  const highs = (r.html.match(/, high day"/g) || []).length;
  assert.strictEqual(lows, 2, 'two low days in the next seven: ' + r.text.slice(0, 300));
  assert.strictEqual(highs, 1);
  assert.ok(/1850/.test(r.html) && /2300/.test(r.html), 'low days at 1850, the high day at 2300');
  assert.ok(/High-day boost/.test(r.text));
});
