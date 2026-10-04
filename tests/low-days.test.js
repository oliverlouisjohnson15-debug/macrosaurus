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
const J = x => JSON.parse(JSON.stringify(x));

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

test('a picked day can be set high, normal or low, and editing leaves Match my training', () => {
  const stale = { enabled: false, highDays: [6], lowDays: [], deltaPct: 0.15 };   // the default profile's stale Saturday
  assert.deepStrictEqual(J(A.setDayKind(stale, 0, 'low')), { enabled: true, followTraining: false, highDays: [], lowDays: [0] },
    'a switched-off plan starts from even');
  const c = { enabled: true, followTraining: true, highDays: [1, 3], lowDays: [0], deltaPct: 0.15 };
  assert.deepStrictEqual(J(A.setDayKind(c, 1, 'low')), { enabled: true, followTraining: false, highDays: [3], lowDays: [0, 1] });
  assert.deepStrictEqual(J(A.setDayKind(c, 0, 'normal')), { enabled: true, followTraining: false, highDays: [1, 3], lowDays: [] });
  assert.strictEqual(A.setDayKind({ enabled: true, highDays: [6], lowDays: [] }, 6, 'normal').enabled, false, 'clearing the last day is an even week');
});

test('a week with a low day is Custom, and Even clears it', () => {
  assert.strictEqual(A.activePresetOf({ enabled: true, highDays: [0, 6], lowDays: [3] }), 'custom');
  assert.strictEqual(A.activePresetOf({ enabled: true, highDays: [0, 6], lowDays: [] }), 'weekend');
  assert.strictEqual(A.activePresetOf({ enabled: true, highDays: [], lowDays: [] }), 'even');
  assert.strictEqual(A.activePresetOf({ enabled: true, followTraining: true, highDays: [1], lowDays: [0] }), 'match');
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
  assert.ok(/Sunday and Wednesday pay for Saturday, giving up 150 kcal each/.test(r.text), 'names who pays: ' + r.text.slice(0, 900));
  assert.ok(/Your other days stay on your usual 2000 kcal/.test(r.text));
  assert.ok(/Low days give up to: -30%/.test(r.text), 'low days get their own depth');
  assert.ok(/Low days come out of/.test(r.text));
});

// ---- the audit: what a low day did to everything else that reads the plan ----

const wkOf = (cfg, base, floor) => E.cyclingWeek(cfg, base, floor);

test('a low day stops at its own depth and says so, rather than turning into a fast', () => {
  // Four high days, one low, 2,000 base: the low day would have to give 1,200 on its own.
  const w = wkOf({ enabled: true, highDays: [1, 2, 4, 5], lowDays: [0], deltaPct: 0.15 }, 2000, 1200);
  assert.strictEqual(w.deltas[0], -600, 'capped at 30% (twice the boost)');
  assert.strictEqual(w.lowCapped, true);
  assert.strictEqual(w.floorLimited, false);
  assert.deepStrictEqual(J(w.kinds), ['low', 'high', 'high', 'normal', 'high', 'high', 'normal']);
  assert.ok(Math.abs(sum(w.deltas)) <= 2);
  // A deeper allowance, set by the person, is honoured up to 35%.
  assert.strictEqual(wkOf({ enabled: true, highDays: [1, 2, 4, 5], lowDays: [0], deltaPct: 0.15, lowPct: 0.35 }, 2000, 1200).deltas[0], -700);
  // ...and the floor still wins over it.
  const f = wkOf({ enabled: true, highDays: [1, 2, 4, 5], lowDays: [0], deltaPct: 0.15 }, 2000, 1500);
  assert.strictEqual(f.deltas[0], -500);
  assert.strictEqual(f.floorLimited, true);
});

test('low days only: their own cut when set', () => {
  assert.deepStrictEqual(week({ enabled: true, lowDays: [0, 6], deltaPct: 0.15, lowPct: 0.2 }, 2000, 1500), [-400, 160, 160, 160, 160, 160, -400]);
});

test('with no floor a day still cannot go below zero', () => {
  const w = week({ enabled: true, highDays: [1, 2, 3, 4, 5, 6], lowDays: [0], deltaPct: 0.35, lowPct: 0.35 }, 1300);
  w.forEach(d => assert.ok(1300 + d >= 0, w.join(', ')));
});

test('a day is named by what the plan made it, not by which way its number moved', () => {
  const lowOnly = { enabled: true, highDays: [], lowDays: [0], deltaPct: 0.15 };
  assert.strictEqual(E.cyclingKind(lowOnly, 2), 'normal');
  assert.strictEqual(E.cyclingKind(lowOnly, 0), 'low');
  assert.strictEqual(E.cyclingKind({ enabled: true, highDays: [6] }, 2), 'normal');
  assert.strictEqual(E.cyclingKind({ enabled: false, highDays: [6] }, 6), null);
  const t = E.composeDayTarget({ base: { kcal: 2000, protein_g: 160, fat_g: 65, carbs_g: 200 }, floorKcal: 1500,
    cycling: lowOnly, cyclingHistory: null, carryover: null, date: '2026-07-28' });   // a Tuesday
  assert.strictEqual(t.cycKind, 'normal');
  assert.ok(t.cyc > 0);
  assert.strictEqual(A.cycLabel(t), 'From your low days', 'not "high day"');
  assert.strictEqual(A.cycLabel({ cyc: -50, cycKind: 'normal' }), 'Towards your high days', 'not "low day"');
  assert.strictEqual(A.cycLabel({ cyc: 300, cycKind: 'high' }), 'High day');
  assert.strictEqual(A.cycLabel({ cyc: -150, cycKind: 'low' }), 'Low day');
});

function acct(cyc, extra) {
  const db = A.Store.defaultState();
  const today = A.Store.todayISO();
  db.profile = Object.assign({}, db.profile, { sex: 'male', age: 32, heightCm: 178, weightKg: 84, bodyFatPct: 22, activityLevel: 'moderate',
    goalType: 'cut', rateKgPerWeek: 0.5, dietStyle: 'balanced', carryover: { enabled: false, mode: 'dispersed', capKcal: 400 }, cycling: cyc,
    cyclingHistory: [Object.assign({ effective_date: null }, cyc)] }, extra || {});
  db.targets = [{ id: 't1', effective_date: A.shiftISO(today, -30), kcal: 2000, protein_g: 160, carbs_g: 200, fat_g: 65 }];
  db.last_checkin = today;
  return db;
}

test('the weight chart only calls a HIGH day a big day', () => {
  const today = A.Store.todayISO();
  const lowOnly = acct({ enabled: true, highDays: [], lowDays: [0], deltaPct: 0.15 });
  assert.strictEqual(A.recentHighDates(lowOnly, today).length, 0, 'normal days going up to cover a low day are not big days');
  const sat = acct({ enabled: true, highDays: [6], lowDays: [0], deltaPct: 0.15 });
  const got = A.recentHighDates(sat, today);
  assert.strictEqual(got.length, 2, 'two Saturdays in a fortnight');
  got.forEach(d => assert.strictEqual(new Date(d + 'T00:00:00Z').getUTCDay(), 6));
});

test('a low day can take half its cut from fat', () => {
  const opts = { base: { kcal: 2000, protein_g: 180, fat_g: 70, carbs_g: 200 }, floorKcal: 1200, carryover: null, date: '2026-07-26' };  // a Sunday
  const carbsOnly = E.composeDayTarget(Object.assign({}, opts, { cycling: { enabled: true, highDays: [6], lowDays: [0], deltaPct: 0.25 } }));
  const both = E.composeDayTarget(Object.assign({}, opts, { cycling: { enabled: true, highDays: [6], lowDays: [0], deltaPct: 0.25, lowFatShare: 0.5 } }));
  assert.strictEqual(carbsOnly.eff.kcal, both.eff.kcal, 'same calories either way');
  assert.strictEqual(carbsOnly.eff.fat_g, 70);
  assert.ok(both.eff.fat_g < 70 && both.eff.fat_g >= 35, 'fat comes down, never below half: ' + both.eff.fat_g);
  assert.ok(both.eff.carbs_g > carbsOnly.eff.carbs_g, 'and carbs keep more');
  // A high day is untouched by the setting.
  const sat = E.composeDayTarget(Object.assign({}, opts, { date: '2026-08-01', cycling: { enabled: true, highDays: [6], lowDays: [0], deltaPct: 0.25, lowFatShare: 0.5 } }));
  assert.strictEqual(sat.eff.fat_g, 70);
});

test('Match my training: training days high, rest days low, and it follows the block', () => {
  const today = A.Store.todayISO();
  const db = acct({ enabled: false, highDays: [], lowDays: [], deltaPct: 0.15 });
  assert.strictEqual(A.trainingShape(db), null, 'no block, nothing to match');
  // A running block training Mon, Wed, Fri (training counts weekdays from Monday = 0).
  const block = { id: 'b1', name: 'Test', startISO: A.shiftISO(today, -3), weeks: 6, shape: 'custom',
    days: [{ id: 'd1', dayOfWeek: 0, slots: [] }, { id: 'd2', dayOfWeek: 2, slots: [] }, { id: 'd3', dayOfWeek: 4, slots: [] }] };
  db.training = { blocks: [block], logs: [], custom: [], volumeTargets: {}, prefs: {} };
  const orig = A.Training.trainingDaysOfWeek;
  A.Training.trainingDaysOfWeek = () => [0, 2, 4];
  const origBlock = A.activeBlock;
  try {
    const ts = A.trainingShape(db);
    assert.ok(ts, 'the running block is seen');
    assert.deepStrictEqual(J(ts), { highDays: [1, 3, 5], lowDays: [0, 2, 4, 6] }, 'Mon/Wed/Fri high, the rest low');
    db.profile.cycling = { enabled: true, followTraining: true, highDays: [1, 3, 5], lowDays: [0, 2, 4, 6], deltaPct: 0.15 };
    assert.strictEqual(A.trainingShapeDrift(db), null, 'already matching');
    A.Training.trainingDaysOfWeek = () => [0, 1, 3, 4];
    assert.deepStrictEqual(J(A.trainingShapeDrift(db).highDays), [1, 2, 4, 5], 'the block moved, the shape follows');
    db.profile.cycling.followTraining = false;
    assert.strictEqual(A.trainingShapeDrift(db), null, 'a hand-made week is left alone');
  } finally { A.Training.trainingDaysOfWeek = orig; }
});

test('the settings line names the days', () => {
  assert.strictEqual(A.weeklyShapeSummary({ enabled: false }), 'Even');
  assert.strictEqual(A.weeklyShapeSummary({ enabled: true, highDays: [6], lowDays: [0, 3], deltaPct: 0.15 }), 'Sat high +15% · Sun, Wed low');
  assert.strictEqual(A.weeklyShapeSummary({ enabled: true, highDays: [0, 6], lowDays: [], deltaPct: 0.2 }), 'Weekends high +20%');
  assert.strictEqual(A.weeklyShapeSummary({ enabled: true, followTraining: true, highDays: [1, 3, 5], lowDays: [0, 2, 4, 6], deltaPct: 0.15 }),
    'Training · Mon, Wed, Fri high +15% · Sun, Tue, Thu, Sat low');
});

test('a plan carrying a low-day depth or fat share is dated when either changes', () => {
  const today = A.Store.todayISO();
  const db = acct({ enabled: true, highDays: [6], lowDays: [0], deltaPct: 0.15 });
  const p1 = A.pendingCyclingChange(db, { enabled: true, highDays: [6], lowDays: [0], deltaPct: 0.15, lowPct: 0.2 }, today, today);
  assert.ok(p1 && p1.entry.lowPct === 0.2);
  const p2 = A.pendingCyclingChange(db, { enabled: true, highDays: [6], lowDays: [0], deltaPct: 0.15, lowFatShare: 0.5 }, today, today);
  assert.ok(p2 && p2.entry.lowFatShare === 0.5);
});
