'use strict';
// The check-in reads a burn as food minus what the scale moved. Both halves must describe the SAME
// days. The rate is read mean-to-mean across this cycle and the last, so the food has to span both
// too: pairing it with this cycle's food alone charged the previous target's weight change to the
// new target's intake, and after every cut the burn read low. These tests pin the matched read.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const isoAdd = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const profile = { sex: 'male', weightKg: 85, heightCm: 175, age: 32, avgSteps: 12000, gymSessionsPerWeek: 5, bodyFatPct: 22,
  dietStyle: 'balanced', goalType: 'cut', rateKgPerWeek: 0.6, weight_unit: 'kg', weighCadence: 'daily' };

// A body that burns `burn` a day, every day: the scale moves by exactly what each day's eating
// leaves over, from the next morning (plus an optional repeating wobble).
function world({ burn = 2900, intake, days = 42, start = '2026-09-01', wobble = [0] }) {
  const kcal = {}, weights = [];
  let kg = 88;
  for (let i = 0; i < days; i++) {
    const d = isoAdd(start, i);
    weights.push({ date: d, kg: +(kg + wobble[i % wobble.length]).toFixed(3) });
    kcal[d] = intake(i);
    kg += (kcal[d] - burn) / 7700;
  }
  return { kcal, weights, today: isoAdd(start, days - 1) };
}

function decide(w, extra = {}) {
  const today = w.today, cs = isoAdd(today, -6);
  const kcalByDate = {}, targetByDate = {};
  for (let d = cs; d <= today; d = isoAdd(d, 1)) { kcalByDate[d] = w.kcal[d]; targetByDate[d] = 2000; }
  return E.checkInDecision(Object.assign({
    profile, currentTargets: { kcal: 1900, protein_g: 170 },
    weights: w.weights, kcalByDate, targetByDate, cycleStart: cs, today, cycleDays: 7,
    weighDays: 7, minDays: 5, periodDays: 7, expenditure: { kcal: 2900, n: 6, q: 1 }, checkins: [],
  }, extra));
}

test('steady eating: the matched read and the window-only read agree, and both find the true burn', () => {
  const w = world({ intake: () => 2300 });
  const old = decide(w);
  const matched = decide(w, { intakeByDate: w.kcal });
  assert.ok(matched.estimate.matched, 'matched read used');
  assert.ok(Math.abs(matched.estimate.tdee - 2900) <= 40, 'matched ' + matched.estimate.tdee);
  assert.ok(Math.abs(old.estimate.tdee - matched.estimate.tdee) <= 40, old.estimate.tdee + ' vs ' + matched.estimate.tdee);
  assert.ok(!matched.estimate.transition, 'no step in eating, no transition');
});

test('a correction mid-stream: the window-only read charges the old weeks to the new food, the matched read does not', () => {
  // 2300 a day, then a cut to 1900 from the start of this cycle. The burn never changed.
  const w = world({ intake: (i) => (i < 35 ? 2300 : 1900) });
  const old = decide(w);
  const matched = decide(w, { intakeByDate: w.kcal });
  assert.ok(2900 - old.estimate.tdee >= 150, 'the bug: window-only reads the burn low, got ' + old.estimate.tdee);
  assert.ok(Math.abs(matched.estimate.tdee - 2900) <= 60, 'matched reads the real burn, got ' + matched.estimate.tdee);
  // The food it used spans both weeks, so it sits between the two intakes rather than at the new one.
  assert.ok(matched.estimate.avgKcal > 1950 && matched.estimate.avgKcal < 2250, 'matched food ' + matched.estimate.avgKcal);
});

test('a big step in eating is flagged and counted at reduced weight, and the result says so', () => {
  const w = world({ intake: (i) => (i < 35 ? 2300 : 1800) });
  const r = decide(w, { intakeByDate: w.kcal, expenditure: { kcal: 2700, n: 6, q: 1 } });
  assert.ok(r.estimate.transition, 'transition flagged');
  assert.ok(r.estimate.transition.fromKcal > r.estimate.transition.toKcal);
  assert.ok(r.transition, 'carried on the decision');
  assert.ok(/stored carbs and the water/.test(r.reason) && /about a third/.test(r.reason), r.reason);
  // The learned burn moves at most ~a third of what an ordinary week would let it.
  assert.ok(r.expenditure.k <= 0.35 * 0.85 + 1e-9, 'gain ' + r.expenditure.k);
});

test('too little trusted food under the span (off-plan days left out): falls back, never guesses', () => {
  const w = world({ intake: (i) => (i < 35 ? 2300 : 1900) });
  const trusted = {};
  Object.keys(w.kcal).forEach(d => { if (d >= isoAdd(w.today, -6)) trusted[d] = w.kcal[d]; });
  const r = decide(w, { intakeByDate: trusted });
  assert.ok(!r.estimate.matched, 'not matched when only this window is trusted');
  const old = decide(w);
  assert.strictEqual(r.estimate.tdee, old.estimate.tdee, 'same as the window-only read');
});

test('matchedIntake: shares sum to the span the change covers, and nothing lands after today', () => {
  const w = world({ intake: () => 2300 });
  const today = w.today, cs = isoAdd(today, -6);
  const m = E.matchedIntake({ weights: w.weights, cycleStart: cs, today, cycleDays: 7, intakeByDate: w.kcal });
  const cm = E.cycleMeans({ weights: w.weights, cycleStart: cs, today, cycleDays: 7 });
  assert.ok(Math.abs(m.span - cm.spanDays) <= 0.6, m.span + ' vs ' + cm.spanDays);
  assert.ok(Object.keys(m.kernel).every(d => d < today));
  assert.strictEqual(m.coverage, 1);
});

test('weight-only lane: the assumed intake is the plan that was in force over the span, not just today\'s', () => {
  const w = world({ intake: (i) => (i < 35 ? 2300 : 1900) });
  const r = decide(w, { mode: 'weightOnly', plannedByDate: w.kcal, currentTargets: { kcal: 1900, protein_g: 170 } });
  assert.ok(r.estimate.matched && r.estimate.weightOnly);
  assert.ok(Math.abs(r.estimate.tdee - 2900) <= 60, 'weight-only matched burn ' + r.estimate.tdee);
});

// The message has to name what actually moved the number.
const cut081 = Object.assign({}, profile, { rateKgPerWeek: 0.81 });
const adjust = (est, extra = {}) => E.weeklyAdjust(Object.assign({
  profile: cut081, currentTargets: { kcal: 1716, protein_g: 170 }, estimate: est,
  adherenceDays: 7, weighDays: 7, periodDays: 7, logWindow: 7, expenditure: { kcal: 2750, n: 8, q: 1 }, prevRateKgPerWeek: 0.93,
}, extra));

test('pace eased by a phase, burn fell: credits the pace, never claims the burn went up', () => {
  const r = adjust({ tdee: 2600, avgKcal: 1808, weeklyChangeKg: -0.663, days: 7 });
  assert.strictEqual(r.direction, 'up');
  assert.ok(/your pace eases from 0\.93 kg\/wk to 0\.81 kg\/wk/.test(r.reason), r.reason);
  assert.ok(/more than makes up for your burn reading lower/.test(r.reason), r.reason);
  assert.ok(!/burn reads higher/.test(r.reason), r.reason);
});

test('a week is judged against the pace it was run at, not the one the phase just set', () => {
  const r = adjust({ tdee: 2600, avgKcal: 1808, weeklyChangeKg: -0.663, days: 7 });
  assert.ok(/slower than the 0\.93 kg\/wk this week was planned at, but/.test(r.reason), r.reason);
  assert.ok(!/slower than your 0\.81/.test(r.reason), r.reason);
});

test('pace eased and burn rose: both named as reasons', () => {
  const r = adjust({ tdee: 2950, avgKcal: 2150, weeklyChangeKg: -0.67, days: 7 });
  assert.strictEqual(r.direction, 'up');
  assert.ok(/your pace eases .*, and your burn reads higher than the \d+ your targets were built on/.test(r.reason), r.reason);
});

test('no pace change: the existing wording is untouched', () => {
  const r = adjust({ tdee: 2600, avgKcal: 1808, weeklyChangeKg: -0.4, days: 7 }, { prevRateKgPerWeek: 0.81 });
  assert.ok(!/your pace/.test(r.reason), r.reason);
});
