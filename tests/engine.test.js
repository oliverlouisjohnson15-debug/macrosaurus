'use strict';
// Tests for the adaptive engine. Run with:  node --test
// Pure Node, no dependencies. Guards the maths that sets everyone's calorie and macro targets.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

const baseProfile = {
  sex: 'male', weightKg: 92.5, heightCm: 175, age: 32,
  avgSteps: 8000, gymSessionsPerWeek: 3, bodyFatPct: 26,
  dietStyle: 'balanced', goalType: 'cut', rateKgPerWeek: 0.5, weight_unit: 'kg',
};

test('mifflinBMR matches the formula for male and female', () => {
  assert.strictEqual(E.mifflinBMR(baseProfile), 1863.75);
  assert.strictEqual(E.mifflinBMR(Object.assign({}, baseProfile, { sex: 'female' })), 1697.75);
});

test('tdeeBreakdown adds resting + steps + gym and exceeds BMR', () => {
  const bd = E.tdeeBreakdown(baseProfile);
  near(bd.resting, 1863.75 * 1.2, 1);
  near(bd.tdee, bd.resting + bd.stepsKcal + bd.gymKcal, 1);
  assert.ok(bd.tdee > bd.bmr, 'TDEE should exceed BMR');
});

test('goalDailyDelta: cut is a deficit, gain a surplus, maintain zero', () => {
  assert.strictEqual(E.goalDailyDelta('cut', 0.5), -550);
  assert.strictEqual(E.goalDailyDelta('gain', 0.5), 550);
  assert.strictEqual(E.goalDailyDelta('maintain', 0.5), 0);
});

test('macrosFromKcal: Atwater sum matches kcal, fat floor and non-negative carbs hold', () => {
  const m = E.macrosFromKcal(2200, baseProfile);
  // Each macro is rounded independently (carbs derived from unrounded fat), so allow a few kcal of slack.
  near(m.protein_g * 4 + m.fat_g * 9 + m.carbs_g * 4, 2200, 8);
  assert.ok(m.fat_g >= 0.6 * baseProfile.weightKg - 1, 'fat below floor');
  assert.ok(m.carbs_g >= 0, 'carbs negative');
});

test('proteinGrams: uses lean mass, manual override, and g/kg', () => {
  const ffm = 92.5 * (1 - 26 / 100); // 68.45
  assert.strictEqual(E.proteinGrams(baseProfile), Math.round(2.4 * ffm)); // cut default 2.4
  assert.strictEqual(E.proteinGrams(Object.assign({}, baseProfile, { proteinManualG: 200 })), 200);
  assert.strictEqual(E.proteinGrams(Object.assign({}, baseProfile, { proteinGPerKgLBM: 2.0 })), Math.round(2.0 * ffm));
});

test('computeInitialTargets: applies goal delta and never drops below the floor', () => {
  const t = E.computeInitialTargets(baseProfile);
  assert.ok(t.kcal < t.estimatedTDEE, 'a cut should sit below TDEE');
  near(t.protein_g * 4 + t.fat_g * 9 + t.carbs_g * 4, t.kcal, 8);
  const extreme = E.computeInitialTargets(Object.assign({}, baseProfile, { rateKgPerWeek: 5 }));
  assert.ok(extreme.kcal >= E.KCAL_FLOOR, 'must respect the 1200 kcal floor');
});

test('cyclingDelta: high and low days net to zero across the week', () => {
  const cfg = { enabled: true, highDays: [6, 0], deltaPct: 0.15 };
  let sum = 0;
  for (let d = 0; d < 7; d++) sum += E.cyclingDelta(cfg, d, 2000);
  near(sum, 0, 1);
  assert.strictEqual(E.cyclingDelta({ enabled: false, highDays: [1], deltaPct: 0.15 }, 1, 2000), 0);
  assert.strictEqual(E.cyclingDelta({ enabled: true, highDays: [0,1,2,3,4,5,6], deltaPct: 0.15 }, 1, 2000), 0);
});

test('carryover: banks surplus/deficit and clamps to the cap', () => {
  assert.strictEqual(E.carryover(2000, 1500), 500);
  assert.strictEqual(E.carryover(2000, 2600, 500), -500); // clamped
  assert.strictEqual(E.carryover(2000, 1800, 500), 200);
});

test('carryoverDispersed: spreads across remaining days and clamps', () => {
  assert.strictEqual(E.carryoverDispersed(600, 3), 200);
  assert.strictEqual(E.carryoverDispersed(9000, 3, 500), 500); // clamped
  assert.strictEqual(E.carryoverDispersed(600, 0), 500); // guards div-by-zero (n=1), clamp 500
});

test('applyKcalDelta: holds protein and fat, flexes carbs, moves kcal', () => {
  const base = { kcal: 2200, protein_g: 180, fat_g: 70 };
  const up = E.applyKcalDelta(base, 200);
  assert.strictEqual(up.protein_g, 180);
  assert.strictEqual(up.fat_g, 70);
  near(up.kcal, 2400, 1);
  assert.ok(up.carbs_g > E.applyKcalDelta(base, 0).carbs_g, 'more kcal should mean more carbs');
});

test('trendSeries: EMA starts at first weight and stays within range', () => {
  const s = E.trendSeries([{ date: 'a', weightKg: 80 }, { date: 'b', weightKg: 79 }, { date: 'c', weightKg: 79.5 }]);
  assert.strictEqual(s[0].trendKg, 80);
  s.forEach(p => assert.ok(p.trendKg <= 80 + 1e-9 && p.trendKg >= 79 - 1e-9));
});

test('estimateExpenditure: intake minus energy balance from the trend', () => {
  const r = E.estimateExpenditure({ dailyKcal: [2000, 2000, 2000], trendStartKg: 80, trendEndKg: 79.5, days: 7 });
  near(r.tdee, 2550, 1); // 2000 + 0.5kg/wk deficit
  near(r.weeklyChangeKg, -0.5, 0.01);
});

test('linreg recovers a known line', () => {
  const r = E.linreg([0, 1, 2, 3], [1, 3, 5, 7]); // y = 2x + 1
  near(r.slope, 2, 1e-6);
  near(r.intercept, 1, 1e-6);
});

test('weeklyAdjust: holds when too few days are logged', () => {
  const r = E.weeklyAdjust({
    profile: baseProfile, currentTargets: { kcal: 2300 },
    estimate: { tdee: 2800, weeklyChangeKg: -0.2, days: 7 }, adherenceDays: 3, periodDays: 7,
  });
  assert.strictEqual(r.changed, false);
});

test('weeklyAdjust: flags likely under-reporting when implied TDEE is near BMR', () => {
  const r = E.weeklyAdjust({
    profile: baseProfile, currentTargets: { kcal: 2300 },
    estimate: { tdee: 1500, weeklyChangeKg: -0.2, days: 7 }, adherenceDays: 7, periodDays: 7,
  });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.underReportFlagged, true);
});

test('weeklyAdjust: nudges down when losing slower than target, within the cap and floor', () => {
  const r = E.weeklyAdjust({
    profile: baseProfile, currentTargets: { kcal: 2300 },
    estimate: { tdee: 2800, weeklyChangeKg: -0.2, days: 7, avgKcal: 2300 },
    adherenceDays: 7, weighDays: 5, periodDays: 7,
  });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.direction, 'down');
  assert.ok(Math.abs(r.deltaKcal) <= r.adjCap, 'delta must respect adjustment cap');
  assert.ok(r.newTargets.kcal >= E.KCAL_FLOOR, 'must respect floor');
  near(r.newTargets.kcal, 2250, 5);
});

test('earlyAdjust: gentle capped nudge UP when a first cycle loses far faster than target', () => {
  const r = E.earlyAdjust({
    profile: Object.assign({}, baseProfile, { goalType: 'cut', rateKgPerWeek: 0.9 }),
    currentTargets: { kcal: 1942 },
    estimate: { tdee: 4000, avgKcal: 1900, weeklyChangeKg: -2.0, days: 6 },
    adherenceDays: 5, weighDays: 5, minDays: 4, periodDays: 6, earlyCap: 150,
  });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.direction, 'up');
  assert.ok(r.deltaKcal > 0 && r.deltaKcal <= 150, 'nudge is positive and within the early cap');
  assert.ok(r.newTargets.kcal > 1942, 'calories increase');
  assert.strictEqual(r.earlyPhase, true);
});

test('earlyAdjust: holds early when at/under target (never over-cuts off noisy first week)', () => {
  const r = E.earlyAdjust({
    profile: Object.assign({}, baseProfile, { goalType: 'cut', rateKgPerWeek: 0.9 }),
    currentTargets: { kcal: 1942 },
    estimate: { tdee: 2400, avgKcal: 1900, weeklyChangeKg: -0.8, days: 6 },
    adherenceDays: 5, weighDays: 5, minDays: 4, periodDays: 6,
  });
  assert.strictEqual(r.changed, false);
});

test('earlyAdjust: holds when too few days are logged', () => {
  const r = E.earlyAdjust({
    profile: Object.assign({}, baseProfile, { goalType: 'cut', rateKgPerWeek: 0.9 }),
    currentTargets: { kcal: 1942 },
    estimate: { tdee: 4000, avgKcal: 1900, weeklyChangeKg: -2.0, days: 6 },
    adherenceDays: 2, weighDays: 2, minDays: 4, periodDays: 6,
  });
  assert.strictEqual(r.changed, false);
});

test('rateGuidance: caps and tooFast flag behave', () => {
  assert.strictEqual(E.rateGuidance(Object.assign({}, baseProfile, { goalType: 'maintain' })).tooFast, false);
  const gain = E.rateGuidance(Object.assign({}, baseProfile, { goalType: 'gain', rateKgPerWeek: 1 }));
  assert.strictEqual(gain.pctCap, 0.005);
  assert.strictEqual(gain.tooFast, true);
  const slowCut = E.rateGuidance(Object.assign({}, baseProfile, { rateKgPerWeek: 0.3 }));
  assert.strictEqual(slowCut.tooFast, false);
});

test('fiberTarget: scales with kcal and clamps to 18..38', () => {
  assert.strictEqual(E.fiberTarget(2000).min, 24);
  assert.strictEqual(E.fiberTarget(500).min, 18); // clamped low
  assert.strictEqual(E.fiberTarget(6000).min, 38); // clamped high
});

test('liveExpenditure: refuses to guess without enough data, and produces a band when it has it', () => {
  const thin = E.liveExpenditure({ weights: [{ date: '2026-07-06', kg: 80 }], kcalByDate: {}, today: '2026-07-07' });
  assert.strictEqual(thin.ok, false);

  const weights = [], kcalByDate = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date('2026-07-07T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    weights.push({ date: iso, kg: +(80 - (13 - i) * 0.05).toFixed(2) }); // gentle downward trend
    kcalByDate[iso] = 2200;
  }
  const r = E.liveExpenditure({ weights, kcalByDate, today: '2026-07-07', windowDays: 14, currentTargetKcal: 2300, goalType: 'cut', rateKgPerWeek: 0.5, bmr: E.mifflinBMR(baseProfile) });
  assert.strictEqual(r.ok, true);
  assert.ok(isFinite(r.tdee) && r.tdee > 0, 'tdee should be a positive number');
  assert.ok(r.band >= 40, 'band should never claim silly precision');
  assert.ok(['low', 'medium', 'high'].includes(r.confidence));
  assert.ok(r.forecast && typeof r.forecast.text === 'string');
});
