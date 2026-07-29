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

// cycleMeans is what the check-in SHEET shows and what checkInDecision decides on. If the two ever
// drift apart, the app starts displaying one number and acting on another, which is the exact
// confusion this split was made to end.
test('cycleMeans: daily cadence returns the EMA cycle means the decision uses', () => {
  const weights = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date('2026-07-14T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    weights.push({ date: d.toISOString().slice(0, 10), kg: +(84 - (13 - i) * 0.1).toFixed(2) });
  }
  const cm = E.cycleMeans({ weights, cycleStart: '2026-07-08', today: '2026-07-14', cycleDays: 7 });
  assert.strictEqual(cm.source, 'trend');
  assert.strictEqual(cm.count, 7);
  assert.strictEqual(cm.spanDays, 7);
  assert.ok(cm.cur < cm.prev, 'a falling series should read lower this cycle than last');
  // Smoothed, so the cycle mean lags the raw mean of the same days (which is 83.0).
  const rawCur = weights.filter(w => w.date >= '2026-07-08').reduce((a, w) => a + w.kg, 0) / 7;
  assert.ok(cm.cur > rawCur, 'EMA cycle mean should lag the raw mean of a falling series');
});

test('cycleMeans: single cadence diffs the two latest readings over their real gap', () => {
  const weights = [
    { date: '2026-06-29', kg: 85.0 },
    { date: '2026-07-06', kg: 84.2 },   // last reading before the cycle
    { date: '2026-07-14', kg: 83.4 },   // this cycle's reading
  ];
  const cm = E.cycleMeans({ weights, cycleStart: '2026-07-07', today: '2026-07-14', cycleDays: 8, weighCadence: 'single' });
  assert.strictEqual(cm.source, 'reading');
  assert.strictEqual(cm.cur, 83.4);
  assert.strictEqual(cm.prev, 84.2);
  assert.strictEqual(cm.prevDate, '2026-07-06');
  assert.strictEqual(cm.spanDays, 8, 'span is the gap between the two readings, not the cycle length');
  assert.strictEqual(cm.count, 1);
});

test('cycleMeans: says nothing rather than guessing when a side has no weigh-ins', () => {
  const cm = E.cycleMeans({ weights: [{ date: '2026-07-14', kg: 83.4 }], cycleStart: '2026-07-08', today: '2026-07-14', cycleDays: 7, weighCadence: 'single' });
  assert.strictEqual(cm.cur, 83.4);
  assert.strictEqual(cm.prev, null);
  const empty = E.cycleMeans({ weights: [], cycleStart: '2026-07-08', today: '2026-07-14', cycleDays: 7 });
  assert.strictEqual(empty.cur, null);
  assert.strictEqual(empty.prev, null);
  assert.strictEqual(empty.count, 0);
});

test('cycleMeans matches what checkInDecision reports back for the same inputs', () => {
  const weights = [], kcalByDate = {}, targetByDate = {};
  for (let i = 27; i >= 0; i--) {
    const d = new Date('2026-07-14T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    weights.push({ date: iso, kg: +(92.5 - (27 - i) * 0.07).toFixed(2) });
    kcalByDate[iso] = 2300; targetByDate[iso] = 2300;
  }
  const opts = {
    profile: baseProfile, currentTargets: { kcal: 2300, protein_g: 180, carbs_g: 230, fat_g: 70 },
    weights, kcalByDate, targetByDate, cycleStart: '2026-07-08', today: '2026-07-14', cycleDays: 7,
    weighDays: 7, minDays: 4, periodDays: 7, expenditure: { kcal: 2800, n: 3 }, checkins: [],
  };
  const cm = E.cycleMeans(opts);
  const dec = E.checkInDecision(opts);
  assert.strictEqual(dec.status, 'proposed');
  // The rate the decision reports is exactly the movement between the two means it was handed.
  near(dec.estimate.weeklyChangeKg, ((cm.cur - cm.prev) / cm.spanDays) * 7, 0.01);
});

// ---- body fat: three rulers, one honest trend ----
test('bodyFatTrend: damps daily smart-scale noise instead of chasing it', () => {
  const noisy = [24.0, 26.0, 22.5, 25.5, 23.0, 25.0, 23.5].map((pct, i) => {
    const d = new Date('2026-07-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), pct, source: 'scale' };
  });
  const ts = E.bodyFatTrend(noisy);
  const last = ts[ts.length - 1];
  // Readings swing 3.5 points; the trend must sit near their middle, not on the last reading.
  assert.ok(Math.abs(last.trendPct - 24.2) < 1.2, `trend ${last.trendPct} should sit near the middle`);
  assert.notStrictEqual(last.trendPct, last.pct);
});

test('bodyFatTrend: a new measurement method restarts the trend rather than blending rulers', () => {
  const ts = E.bodyFatTrend([
    { date: '2026-06-01', pct: 24, source: 'scale' },
    { date: '2026-06-02', pct: 24, source: 'scale' },
    { date: '2026-06-03', pct: 18, source: 'manual' },   // a DEXA: a different ruler, not a 6-point drop
  ]);
  assert.strictEqual(ts[2].trendPct, 18, 'the DEXA reading stands on its own');
  assert.strictEqual(E.bodyFatNow(ts.map(r => ({ date: r.date, pct: r.pct, source: r.source }))).source, 'manual');
});

test('bodyFatTrend: an episodic reading after a long gap becomes the trend', () => {
  const ts = E.bodyFatTrend([
    { date: '2026-04-01', pct: 24, source: 'photo' },
    { date: '2026-06-01', pct: 19, source: 'photo' },    // 61 days later, same ruler
  ]);
  assert.ok(Math.abs(ts[1].trendPct - 19) < 0.2, 'a two-month-old reading should not hold the trend back');
});

test('bodyFatNow: reports the trend to act on, plus where it came from', () => {
  assert.strictEqual(E.bodyFatNow([]), null);
  const now = E.bodyFatNow([
    { date: '2026-07-01', pct: 22, source: 'scale' },
    { date: '2026-07-02', pct: 23, source: 'scale' },
  ]);
  assert.strictEqual(now.source, 'scale');
  assert.strictEqual(now.n, 2);
  assert.strictEqual(now.nSameSource, 2);
  assert.ok(now.pct > 22 && now.pct < 23, 'acts on the trend, not the last reading');
});

test('bodyFatReadingDue: asks when the body has moved, not on a calendar', () => {
  const readings = [{ date: '2026-06-01', pct: 22, source: 'scale' }];
  // Same weight, three weeks on: nothing to say.
  const quiet = E.bodyFatReadingDue({ readings, weightKg: 84, weightAtLastReadingKg: 84, today: '2026-06-22' });
  assert.strictEqual(quiet.due, false);
  // 4 kg down on an 84 kg frame is past 3%: the old figure now misprices protein.
  const moved = E.bodyFatReadingDue({ readings, weightKg: 80, weightAtLastReadingKg: 84, today: '2026-06-22' });
  assert.strictEqual(moved.due, true);
  assert.strictEqual(moved.reason, 'moved');
  // ...but not the very next day, however fast the scale moved.
  assert.strictEqual(E.bodyFatReadingDue({ readings, weightKg: 80, weightAtLastReadingKg: 84, today: '2026-06-05' }).due, false);
  // Twelve weeks with no movement at all still goes stale eventually.
  assert.strictEqual(E.bodyFatReadingDue({ readings, weightKg: 84, weightAtLastReadingKg: 84, today: '2026-09-01' }).reason, 'stale');
  // Never recorded: invited elsewhere, never nagged for here.
  assert.strictEqual(E.bodyFatReadingDue({ readings: [], weightKg: 84, today: '2026-09-01' }).due, false);
});
