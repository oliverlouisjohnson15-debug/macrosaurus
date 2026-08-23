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
  // The split has to account for the day's fibre as well: fibre is logged separately from carbs and
  // carries 2 kcal/g, so leaving it out of the carb target spends those calories twice and the macro
  // meters outlast the calorie ring by 2 kcal per gram of fibre eaten.
  // Each macro is rounded independently (carbs derived from unrounded fat), so allow a few kcal of slack.
  near(m.protein_g * 4 + m.fat_g * 9 + m.carbs_g * 4 + E.fiberReserveKcal(2200), 2200, 8);
  assert.ok(m.fat_g >= 0.6 * baseProfile.weightKg - 1, 'fat below floor');
  assert.ok(m.carbs_g >= 0, 'carbs negative');
});

// The user-visible version of the same invariant: eat the target exactly, fibre included, and the
// calorie ring and every macro meter must run out at the same moment.
test('eating the target exactly, fibre included, lands on the calorie target', () => {
  for (const kcal of [1400, 1800, 2200, 2800, 3400]) {
    const m = E.macrosFromKcal(kcal, baseProfile);
    const fib = E.fiberTarget(kcal).min;
    const eaten = m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9 + fib * 2;
    near(eaten, kcal, 8);
  }
});

test('a cycled/carryover day keeps the same invariant after applyKcalDelta', () => {
  const base = E.macrosFromKcal(2200, baseProfile);
  for (const delta of [-400, -150, 0, 150, 400]) {
    const eff = E.applyKcalDelta(base, delta);
    const fib = E.fiberTarget(eff.kcal).min;
    near(eff.protein_g * 4 + eff.carbs_g * 4 + eff.fat_g * 9 + fib * 2, eff.kcal, 8);
  }
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
  near(t.protein_g * 4 + t.fat_g * 9 + t.carbs_g * 4 + E.fiberReserveKcal(t.kcal), t.kcal, 8);
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

// ---- a fresh start is a line, and the check-in reads only the side of it you are on ----
// The reset already forgets the learned expenditure (Store.FRESH_ALWAYS). Until floorISO existed the
// weight read did NOT forget the rest, so the first check-in of a new run diffed it against the plan
// it had just replaced. Worse, the previous-cycle window kept whichever mornings happened to land
// after the line, so a single rebound reading could end up being the entire baseline the new run was
// measured against, and the rate reported belonged to neither run.
const FRESH_WEIGHTS = [
  // the old run: settled, and nothing to do with the plan that replaces it
  { date: '2026-08-10', kg: 90.70 },
  { date: '2026-08-11', kg: 90.60 },
  { date: '2026-08-12', kg: 90.40 },
  // a gap, then one rebound morning, still on the old plan and one day before the line
  { date: '2026-08-17', kg: 92.50 },
  // the fresh start is 2026-08-18; everything below is the new run
  { date: '2026-08-18', kg: 91.20 },
  { date: '2026-08-19', kg: 90.80 },
  { date: '2026-08-20', kg: 90.28 },
  { date: '2026-08-21', kg: 89.85 },
  { date: '2026-08-22', kg: 90.15 },
  { date: '2026-08-23', kg: 89.85 },
];
const FRESH_CYCLE = { cycleStart: '2026-08-18', today: '2026-08-23', cycleDays: 6 };

test('cycleMeans: a fresh start floors what the decision may read', () => {
  const across = E.cycleMeans(Object.assign({ weights: FRESH_WEIGHTS }, FRESH_CYCLE));
  const floored = E.cycleMeans(Object.assign({ weights: FRESH_WEIGHTS, floorISO: '2026-08-18' }, FRESH_CYCLE));
  // Without the floor there is a "previous cycle", made of the old run's last days plus the rebound.
  assert.ok(across.prev != null, 'guard: without a floor the old run is still being read');
  // With it there is no complete previous cycle yet, so the decision is told so rather than handed a
  // baseline assembled from the far side of the reset.
  assert.strictEqual(floored.prev, null);
  assert.strictEqual(floored.count, 6, 'the current cycle is unaffected: same six mornings');
  // ...and the current mean no longer carries the old run in through the EMA either.
  assert.ok(floored.cur < across.cur, 'the pre-reset rebound was propping the current mean up');
});

test('cycleMeans: a clipped baseline is used when it is still most of a cycle, not scraps', () => {
  // The line falls two days into what would have been the previous cycle, leaving 4 of 6 days. That
  // is scraps: it neither spans most of a cycle nor carries enough mornings, and a baseline decided
  // by where the line happened to fall is worse than none.
  const scraps = E.cycleMeans(Object.assign({ weights: FRESH_WEIGHTS, floorISO: '2026-08-14' }, FRESH_CYCLE));
  assert.strictEqual(scraps.prev, null, '4 of 6 days is under the coverage bar');
  assert.strictEqual(scraps.prevPartial, false);

  // The real case this exists for: a reset one day into the previous cycle. 6 of 7 days survive,
  // all six carry weigh-ins, and every one of them is after the line. Discarding that would send an
  // established user back through the first-cycle path on a week of perfectly good data.
  const nearly = E.cycleMeans({
    weights: FRESH_WEIGHTS.concat([
      { date: '2026-08-24', kg: 89.90 }, { date: '2026-08-25', kg: 89.70 },
      { date: '2026-08-26', kg: 89.75 }, { date: '2026-08-27', kg: 89.50 },
      { date: '2026-08-28', kg: 89.55 }, { date: '2026-08-29', kg: 89.30 },
      { date: '2026-08-30', kg: 89.35 },
    ]),
    floorISO: '2026-08-18', cycleStart: '2026-08-24', today: '2026-08-30', cycleDays: 7,
  });
  assert.ok(nearly.prev != null, '6 of 7 days, all post-reset, is a baseline');
  assert.strictEqual(nearly.prevPartial, true, 'and it says so rather than posing as a full cycle');
  assert.ok(nearly.prev < 92, 'built from the new run only - the 92.5 rebound is the far side of the line');
  // The two means sit 6.5 days apart, not the nominal 7, and the span says so.
  assert.ok(nearly.spanDays < 7 && nearly.spanDays > 6, `spanDays ${nearly.spanDays}`);
});

test('cycleMeans: the span is the real gap between the means, not the nominal cycle', () => {
  // A series falling exactly 0.1 kg/day must read -0.7 kg/wk. It only does if the rate is divided
  // by the gap between where the two means actually sit; with uneven coverage the nominal cycle
  // length is not that gap, and using it states the movement over a span that never happened.
  const all = [];
  for (let i = 0; i < 61; i++) {
    const d = new Date('2026-07-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
    all.push({ date: d.toISOString().slice(0, 10), kg: +(95 - 0.1 * i).toFixed(3) });
  }
  const rateOf = cm => ((cm.cur - cm.prev) / cm.spanDays) * 7;

  const full = E.cycleMeans({ weights: all, cycleStart: '2026-08-24', today: '2026-08-30', cycleDays: 7 });
  assert.strictEqual(full.spanDays, 7, 'even coverage: the means sit exactly a cycle apart, as always assumed');
  near(rateOf(full), -0.7, 0.02);

  // Now weigh only the back half of the current cycle. Its mean slides later, the real gap widens,
  // and the rate must stay -0.7 - dividing by 7 would understate it.
  const sparse = all.filter(w => !(w.date >= '2026-08-24' && w.date <= '2026-08-26'));
  const uneven = E.cycleMeans({ weights: sparse, cycleStart: '2026-08-24', today: '2026-08-30', cycleDays: 7 });
  assert.ok(uneven.spanDays > 7, `gap widened to ${uneven.spanDays}`);
  // Within a few percent, not exact: the gap-aware EMA raises its effective alpha across the
  // 3-day hole, so the trend sits a touch nearer the raw readings than a daily series would.
  near(rateOf(uneven), -0.7, 0.05);
  const byNominal = ((uneven.cur - uneven.prev) / 7) * 7;
  assert.ok(Math.abs(byNominal) > 0.78, `dividing by cycleDays would have overstated it as ${byNominal.toFixed(3)}`);
});

test('cycleMeans: a clipped baseline reads slightly conservative, and never the other way', () => {
  // Honest limit of clipping. Filtering at the line reseeds the EMA, so a baseline window sitting
  // right against the line is still in the smoothing's warm-up while the current window has
  // converged. On a falling series that lifts the baseline less than convergence would, so the
  // measured rate comes in UNDER the truth. The span fix removes most of the error; this is what
  // is left, and its direction is the safe one - a cut is held rather than chased.
  const all = [];
  for (let i = 0; i < 61; i++) {
    const d = new Date('2026-07-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
    all.push({ date: d.toISOString().slice(0, 10), kg: +(95 - 0.1 * i).toFixed(3) });
  }
  const cycle = { weights: all, cycleStart: '2026-08-24', today: '2026-08-30', cycleDays: 7 };
  const rateOf = cm => ((cm.cur - cm.prev) / cm.spanDays) * 7;
  const clipped = E.cycleMeans(Object.assign({ floorISO: '2026-08-19' }, cycle));
  assert.strictEqual(clipped.prevPartial, true);

  const measured = rateOf(clipped);
  // Understates, never overstates: it will not invent a loss that is not there.
  assert.ok(measured > -0.7, `should read under the true -0.7, got ${measured.toFixed(3)}`);
  assert.ok(measured < -0.5, `but still most of the way there, got ${measured.toFixed(3)}`);
  // And the span fix is carrying most of that: without it the same movement reads far shorter.
  const byNominal = ((clipped.cur - clipped.prev) / 7) * 7;
  assert.ok(Math.abs(measured) > Math.abs(byNominal) + 0.05,
    `span-corrected ${measured.toFixed(3)} should beat nominal ${byNominal.toFixed(3)}`);
  // The warm-up is the whole of the residual: give it a settled floor and the read is exact.
  const settled = E.cycleMeans(Object.assign({ floorISO: '2026-07-05' }, cycle));
  assert.strictEqual(settled.prevPartial, false);
  near(rateOf(settled), -0.7, 0.02);
});

test('cycleMeans: single cadence will not reach back across a fresh start for its baseline', () => {
  const single = { weights: FRESH_WEIGHTS, cycleStart: '2026-08-18', today: '2026-08-23', cycleDays: 6, weighCadence: 'single' };
  const across = E.cycleMeans(single);
  assert.strictEqual(across.prev, 92.50, 'guard: unfloored, the pre-reset rebound is the baseline');
  const floored = E.cycleMeans(Object.assign({ floorISO: '2026-08-18' }, single));
  assert.strictEqual(floored.prev, null, 'nothing on this side of the line to diff against yet');
  assert.strictEqual(floored.cur, 89.85, 'the latest reading still stands');
});

test('checkInDecision: the first check-in after a fresh start is a first cycle again', () => {
  const kcalByDate = {}, targetByDate = {};
  ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']
    .forEach(iso => { kcalByDate[iso] = 2100; targetByDate[iso] = 2100; });
  const opts = {
    profile: baseProfile, currentTargets: { kcal: 2100, protein_g: 180, carbs_g: 200, fat_g: 65 },
    weights: FRESH_WEIGHTS, kcalByDate, targetByDate,
    weighDays: 6, minDays: 4, periodDays: 6, earlyCap: 150,
    expenditure: { kcal: 2800, n: 3 }, checkins: [],
  };
  const across = E.checkInDecision(Object.assign({}, opts, FRESH_CYCLE));
  const floored = E.checkInDecision(Object.assign({ floorISO: '2026-08-18' }, opts, FRESH_CYCLE));
  assert.strictEqual(floored.status, 'proposed');
  // Reading across the line, the old run's settled weight is the baseline and the rate is a fiction
  // built from two plans. Floored, this is the first cycle of a new run: a robust slope off its own
  // raw weigh-ins, discounted for water, and flagged as such.
  assert.ok(!across.earlyPhase, 'guard: unfloored, this looked like an ordinary Nth cycle');
  assert.strictEqual(floored.earlyPhase, true);
  assert.ok(Math.abs(floored.estimate.weeklyChangeKg) > Math.abs(across.estimate.weeklyChangeKg),
    'the new run is genuinely dropping faster than the cross-reset diff made it look');
  // The early path caps how hard a water-heavy first cycle may move the plan.
  assert.ok(Math.abs(floored.deltaKcal || 0) <= 150);
});

// ---- where you are now, versus what the rate was read between ----
// The mean of a week that is moving is roughly its MIDPOINT, so on a fast cycle the cycle mean sits
// days behind the person. It was being used for both jobs: the rate (right) and "your weight" - the
// bodyweight the next plan is built from and the figure the check-in records (wrong, and always
// stale in the direction of travel). curNow answers the second question without disturbing the first.
test('cycleMeans: curNow is where the trend got to, cur is what the rate is read between', () => {
  const weights = [
    { date: '2026-08-18', kg: 91.20 },
    { date: '2026-08-19', kg: 90.80 },
    { date: '2026-08-20', kg: 90.28 },
    { date: '2026-08-21', kg: 89.85 },
    { date: '2026-08-22', kg: 90.15 },
    { date: '2026-08-23', kg: 89.85 },
  ];
  const cm = E.cycleMeans({ weights, cycleStart: '2026-08-18', today: '2026-08-23', cycleDays: 6 });
  assert.ok(cm.curNow < cm.cur, 'on a falling week the mean lags the trend it is averaging');
  // The gap is not a rounding detail: half a kilo of a bodyweight that feeds BMR and gets recorded.
  assert.ok(cm.cur - cm.curNow > 0.3, `mean ${cm.cur} vs trend now ${cm.curNow}`);
  // curNow is the last trend value of the cycle, not the last raw reading (still smoothed).
  const ts = E.trendSeries(weights.map(w => ({ date: w.date, weightKg: w.kg })), E.TREND_ALPHA);
  assert.strictEqual(cm.curNow, ts[ts.length - 1].trendKg);
  assert.notStrictEqual(cm.curNow, 89.85);
});

test('cycleMeans: a flat cycle has nothing to lag, so both readings agree', () => {
  const weights = ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']
    .map(date => ({ date, kg: 90.00 }));
  const cm = E.cycleMeans({ weights, cycleStart: '2026-08-18', today: '2026-08-23', cycleDays: 6 });
  near(cm.curNow, cm.cur, 0.001);
});

test('cycleMeans: prevNow pairs with curNow so a trend delta is endpoint to endpoint', () => {
  const weights = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date('2026-07-14T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    weights.push({ date: d.toISOString().slice(0, 10), kg: +(84 - (13 - i) * 0.1).toFixed(2) });
  }
  const cm = E.cycleMeans({ weights, cycleStart: '2026-07-08', today: '2026-07-14', cycleDays: 7 });
  assert.ok(cm.prevNow != null && cm.curNow != null);
  assert.ok(cm.curNow < cm.prevNow, 'a falling series ends each cycle lower than the last');
  // Both measures describe the same fall, and must not disagree about its size by much, or the
  // headline and the decision panel would be telling the user two different stories. They do not
  // agree exactly, and should not: over a fortnight the EMA is still converging on a steadily
  // falling series, which damps the mean-to-mean span slightly more than the endpoints.
  near(cm.curNow - cm.prevNow, cm.cur - cm.prev, 0.1);
  assert.ok((cm.curNow - cm.prevNow) < 0 && (cm.cur - cm.prev) < 0, 'and never disagree on direction');
});

test('cycleMeans: the rate still reads mean-to-mean, unmoved by the new endpoints', () => {
  // Guard on the split itself: adding curNow must not have quietly changed what the rate is.
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
  near(dec.estimate.weeklyChangeKg, ((cm.cur - cm.prev) / cm.spanDays) * 7, 0.01);
  assert.notStrictEqual(cm.curNow, cm.cur, 'guard: the two really are different numbers here');
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

// ---- the log that never reconciles ----
const underReportCase = (checkins) => {
  const weights = [], kcalByDate = {}, targetByDate = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date('2026-07-29T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    weights.push({ date: iso, kg: 91.5 });        // flat as a pancake
    kcalByDate[iso] = 1600; targetByDate[iso] = 2000;   // while claiming to eat well under target
  }
  return E.checkInDecision({
    profile: Object.assign({}, baseProfile, { weightKg: 91.5, rateKgPerWeek: 0.5 }),
    currentTargets: { kcal: 2000, protein_g: 180, carbs_g: 180, fat_g: 65 },
    weights, kcalByDate, targetByDate, cycleStart: '2026-07-23', today: '2026-07-29', cycleDays: 7,
    weighDays: 7, minDays: 4, periodDays: 7, expenditure: { kcal: 2600, n: 3 }, checkins,
  });
};

test('under-reporting: the first suspicious cycle holds rather than acting on a log it distrusts', () => {
  const first = underReportCase([{ date: '2026-07-22', adhered: true }]);
  assert.strictEqual(first.underReportFlagged, true);
  assert.strictEqual(first.changed, false);
  assert.strictEqual(first.laneSwitched, undefined, 'one strike is not enough to change lane');
  assert.match(first.reason, /under-logged/i);
});

test('under-reporting twice: stop waiting for the log and steer from the scale', () => {
  const second = underReportCase([{ date: '2026-07-22', adhered: true, underReport: true }]);
  assert.strictEqual(second.laneSwitched, 'weightOnly');
  assert.strictEqual(second.estimate.weightOnly, true, 'the read now comes from the weigh-ins');
  assert.match(second.reason, /steer from your weigh-ins alone/i);
  // Flat weight on a cut means the target has to come down: the whole point of not holding forever.
  assert.strictEqual(second.changed, true);
  assert.ok(second.newTargets.kcal < 2000, 'a stalled cut on the scale must move the target');
});

// ---- a window too short for this person's own wobble ----
test('readReliability: a big swinger on a gentle target is told to wait, and when', () => {
  const swings = [0, 1.4, -1.2, 1.1, -1.3, 1.5, -1.1, 1.2, -1.4, 1.0, -1.2, 1.3];
  const weights = swings.map((d, i) => {
    const dt = new Date('2026-07-18T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + i);
    return { date: dt.toISOString().slice(0, 10), kg: +(95 + d).toFixed(2) };
  });
  const r = E.readReliability({ weights, cycleStart: '2026-07-25', today: '2026-07-29', cycleDays: 5, targetRatePerWeek: 0.25, weighCadence: 'daily' });
  assert.strictEqual(r.readable, false);
  assert.ok(r.noiseKg > r.signalKg, 'the wobble genuinely exceeds the change being looked for');
  assert.ok(r.daysNeeded > 5 && r.readyOn > '2026-07-29', 'it must name a date worth coming back on');
});

test('readReliability: a steady weigher on a normal target is left alone', () => {
  const weights = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date('2026-07-29T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    weights.push({ date: d.toISOString().slice(0, 10), kg: +(84 - (11 - i) * 0.08 + (i % 2 ? 0.15 : -0.15)).toFixed(2) });
  }
  assert.strictEqual(E.readReliability({ weights, cycleStart: '2026-07-23', today: '2026-07-29', cycleDays: 7, targetRatePerWeek: 0.5, weighCadence: 'daily' }).readable, true);
});

test('readReliability: says nothing it cannot support, on thin data or a weekly weigher', () => {
  const thin = [{ date: '2026-07-28', kg: 84 }, { date: '2026-07-29', kg: 83.8 }];
  assert.strictEqual(E.readReliability({ weights: thin, cycleStart: '2026-07-23', today: '2026-07-29', cycleDays: 7, targetRatePerWeek: 0.5, weighCadence: 'daily' }).readable, true);
  assert.strictEqual(E.readReliability({ weights: thin, cycleStart: '2026-07-23', today: '2026-07-29', cycleDays: 7, targetRatePerWeek: 0.5, weighCadence: 'single' }).readable, true);
  // Maintenance has no target movement, so there is no noise floor to speak to.
  assert.strictEqual(E.readReliability({ weights: thin, cycleStart: '2026-07-23', today: '2026-07-29', cycleDays: 7, targetRatePerWeek: 0, weighCadence: 'daily' }).readable, true);
});
