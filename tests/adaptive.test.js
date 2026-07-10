'use strict';
// Tests for the adaptive-engine improvements (v59): learned-TDEE carryover on goal changes,
// smoothed expenditure, incomplete-day handling, carryover fixes, gap-aware trend, sex-scaled
// floor + macro squeeze, cycling neutral at the floor, plateau detection, robust slopes, the
// deadband, the extracted composition/check-in pipeline, and a multi-cycle convergence simulation.
// Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

const maleProfile = {
  sex: 'male', weightKg: 92.5, heightCm: 175, age: 32,
  avgSteps: 8000, gymSessionsPerWeek: 3, bodyFatPct: 26,
  dietStyle: 'balanced', goalType: 'cut', rateKgPerWeek: 0.5, weight_unit: 'kg',
};
const femaleProfile = Object.assign({}, maleProfile, { sex: 'female' });

function isoAdd(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---- item 6: sex-scaled floor ----
test('kcalFloor: 1500 for males, 1200 for females and unknown', () => {
  assert.strictEqual(E.kcalFloor(maleProfile), 1500);
  assert.strictEqual(E.kcalFloor(femaleProfile), 1200);
  assert.strictEqual(E.kcalFloor({}), 1200);
  assert.strictEqual(E.kcalFloor(null), 1200);
  assert.strictEqual(E.KCAL_FLOOR, 1200); // exported constant kept for compat
});

test('computeInitialTargets respects the sex-scaled floor', () => {
  const m = E.computeInitialTargets(Object.assign({}, maleProfile, { rateKgPerWeek: 5 }));
  assert.ok(m.kcal >= 1500, 'male floor is 1500');
  const f = E.computeInitialTargets(Object.assign({}, femaleProfile, { rateKgPerWeek: 5 }));
  assert.ok(f.kcal >= 1200, 'female floor is 1200');
});

// ---- item 7: fat floor 0.8 g/kg ----
test('macrosFromKcal: default fat floor is 0.8 g/kg', () => {
  const m = E.macrosFromKcal(2500, maleProfile);
  assert.ok(m.fat_g >= 0.8 * maleProfile.weightKg - 1, `fat ${m.fat_g} below 0.8 g/kg floor`);
  assert.ok(!m.squeezed, 'a comfortable budget should not be squeezed');
});

// ---- item 6: macro reconciliation (squeeze) ----
test('macrosFromKcal: squeezes fat to 0.5 g/kg then protein for a heavy user at the floor', () => {
  const heavy = Object.assign({}, maleProfile, { weightKg: 150, bodyFatPct: null });
  const m = E.macrosFromKcal(1600, heavy);
  assert.strictEqual(m.squeezed, true);
  near(m.fat_g, 0.5 * 150, 1); // fat trimmed all the way to the hard minimum
  assert.ok(m.protein_g < E.proteinGrams(heavy), 'protein trimmed after fat');
  assert.ok(m.protein_g * 4 + m.fat_g * 9 <= 1600 + 5, 'macros fit the kcal budget');
  assert.ok(m.carbs_g >= 0);
});

test('macrosFromKcal: mild squeeze trims fat only, protein preserved', () => {
  // 200g protein manual + tight budget: fat gives way first, protein holds.
  const p = Object.assign({}, maleProfile, { proteinManualG: 200 });
  const m = E.macrosFromKcal(1500, p); // 800 kcal protein + 74g fat floor (666) = 1466 < 1500? no: floor fat 74*9=666, 800+666=1466 <= 1500
  assert.ok(!m.squeezed || m.protein_g === 200, 'protein only trimmed when fat alone cannot fit');
  const m2 = E.macrosFromKcal(1400, p); // 800 + 666 = 1466 > 1400 -> squeeze fat down
  assert.strictEqual(m2.squeezed, true);
  assert.strictEqual(m2.protein_g, 200); // (1400-800)/9 = 66.7g fat, above the 46.25 hard min
  near(m2.fat_g, (1400 - 800) / 9, 1);
});

// ---- item 1: preserve learned TDEE ----
test('computeInitialTargets: opts.priorTdee replaces the formula TDEE', () => {
  const t = E.computeInitialTargets(maleProfile, { priorTdee: 3000 });
  near(t.kcal, 3000 - 550, 1);
  assert.strictEqual(t.estimatedTDEE, 3000);
  assert.strictEqual(t.source, 'formula+learned');
  const plain = E.computeInitialTargets(maleProfile);
  assert.strictEqual(plain.source, 'formula');
  assert.strictEqual(plain.estimatedTDEE, E.tdeeFromProfile(maleProfile));
  // Bad priors are ignored gracefully.
  assert.strictEqual(E.computeInitialTargets(maleProfile, { priorTdee: NaN }).source, 'formula');
});

// ---- item 2: persistent smoothed expenditure ----
test('updateExpenditure: blends from the prior toward the estimate, gain ramps with n and confidence', () => {
  const first = E.updateExpenditure({ kcal: 2500, n: 0 }, 3000, 1);
  near(first.kcal, 2500 + 0.2 * 500, 1); // n=0: lean the formula prior hard
  assert.strictEqual(first.n, 1);
  const second = E.updateExpenditure(first, 3000, 1);
  near(second.kcal, first.kcal + 0.4 * (3000 - first.kcal), 1); // n=1: k=0.4
  const capped = E.updateExpenditure({ kcal: 2500, n: 10 }, 3000, 1);
  near(capped.kcal, 2500 + 0.6 * 500, 1); // gain caps at 0.6
  const lowConf = E.updateExpenditure({ kcal: 2500, n: 10 }, 3000, 0.5);
  near(lowConf.kcal, 2500 + 0.3 * 500, 1); // confidence halves the move
  const seeded = E.updateExpenditure(null, 2800, 1);
  assert.strictEqual(seeded.kcal, 2800); // no prior: adopt the estimate
  assert.strictEqual(E.updateExpenditure({ kcal: 2500, n: 2 }, NaN, 1).kcal, 2500); // bad estimate ignored
});

test('weeklyAdjust: builds desired on the SMOOTHED expenditure when a prior is supplied', () => {
  const r = E.weeklyAdjust({
    profile: maleProfile, currentTargets: { kcal: 2300 },
    estimate: { tdee: 3000, weeklyChangeKg: -0.6, days: 7, avgKcal: 2300 },
    adherenceDays: 7, weighDays: 7, periodDays: 7,
    expenditure: { kcal: 2400, n: 5 },
  });
  // conf=1, n=5 -> k=0.6 -> smoothed 2760; desired 2760-550=2210; delta -90
  assert.strictEqual(r.expenditure.kcal, 2760);
  near(r.newTargets.kcal, 2210, 2);
  assert.strictEqual(r.newTargets.estimatedTDEE, 2760);
});

// ---- item 11: deadband ----
test('weeklyAdjust: holds within the 50 kcal deadband instead of proposing token changes', () => {
  const r = E.weeklyAdjust({
    profile: maleProfile, currentTargets: { kcal: 2300 },
    estimate: { tdee: 2830, weeklyChangeKg: -0.45, days: 7, avgKcal: 2300 },
    adherenceDays: 7, weighDays: 7, periodDays: 7,
  }); // desired 2280, 20 away -> hold
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.holdWithinNoise, true);
  assert.ok(/noise/i.test(r.reason));
});

test('weeklyAdjust: deadband widens to the estimate uncertainty band when available', () => {
  const r = E.weeklyAdjust({
    profile: maleProfile, currentTargets: { kcal: 2300 },
    estimate: { tdee: 2950, weeklyChangeKg: -0.5, days: 7, avgKcal: 2300, band: 120 },
    adherenceDays: 7, weighDays: 7, periodDays: 7,
  }); // desired 2400, 100 away, band 120 -> hold
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.holdWithinNoise, true);
});

// ---- existing gaps: upward + maintain paths ----
test('weeklyAdjust: nudges UP when a cut runs too fast', () => {
  const r = E.weeklyAdjust({
    profile: maleProfile, currentTargets: { kcal: 2300 },
    estimate: { tdee: 3100, weeklyChangeKg: -1.2, days: 7, avgKcal: 2300 },
    adherenceDays: 7, weighDays: 7, periodDays: 7,
  }); // desired 2550
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.direction, 'up');
  assert.ok(r.deltaKcal > 0 && r.deltaKcal <= r.adjCap);
});

test('weeklyAdjust: maintain goal corrects drift back toward the estimated burn', () => {
  const r = E.weeklyAdjust({
    profile: Object.assign({}, maleProfile, { goalType: 'maintain', rateKgPerWeek: 0 }),
    currentTargets: { kcal: 2400 },
    estimate: { tdee: 2700, weeklyChangeKg: -0.3, days: 7, avgKcal: 2400 },
    adherenceDays: 7, weighDays: 7, periodDays: 7,
  }); // desired 2700, drifting down -> add
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.direction, 'up');
});

// ---- item 3: incomplete-day detection ----
test('isCompleteDay: under 60% of target is incomplete; no target counts any logged day', () => {
  assert.strictEqual(E.isCompleteDay(1000, 2000), false);
  assert.strictEqual(E.isCompleteDay(1200, 2000), true);  // exactly 60%
  assert.strictEqual(E.isCompleteDay(1300, 2000), true);
  assert.strictEqual(E.isCompleteDay(0, 2000), false);
  assert.strictEqual(E.isCompleteDay(null, 2000), false);
  assert.strictEqual(E.isCompleteDay(500, null), true);
  assert.strictEqual(E.isCompleteDay(500, 0), true);
});

test('liveExpenditure: incomplete days are dropped from the intake average when targets are given', () => {
  const weights = [], kcalByDate = {}, targetByDate = {};
  for (let i = 13; i >= 0; i--) {
    const iso = isoAdd('2026-07-07', -i);
    weights.push({ date: iso, kg: +(80 - (13 - i) * 0.05).toFixed(2) });
    kcalByDate[iso] = 2200; targetByDate[iso] = 2200;
  }
  // Corrupt three days with abandoned logging; without filtering they'd drag the average down hard.
  ['2026-07-01', '2026-07-02', '2026-07-03'].forEach(d => { kcalByDate[d] = 300; });
  const opts = { weights, kcalByDate, today: '2026-07-07', windowDays: 14, currentTargetKcal: 2300, goalType: 'cut', rateKgPerWeek: 0.5, bmr: 1500 };
  const filtered = E.liveExpenditure(Object.assign({}, opts, { targetByDate }));
  near(filtered.avgKcal, 2200, 1);
  assert.strictEqual(filtered.loggedDays, 11); // the three incomplete days no longer count as logged
  const unfiltered = E.liveExpenditure(opts);
  assert.ok(unfiltered.avgKcal < filtered.avgKcal, 'without targets the incomplete days poison the mean');
});

// ---- item 5: gap-aware trend ----
test('trendSeries: a date gap decays the EMA as that many daily steps would', () => {
  const s = E.trendSeries([
    { date: '2026-07-01', weightKg: 80 },
    { date: '2026-07-08', weightKg: 79 }, // 7-day gap
  ]);
  const effAlpha = 1 - Math.pow(0.9, 7);
  near(s[1].trendKg, 80 + effAlpha * (79 - 80), 0.02);
  // Daily entries behave exactly as before.
  const daily = E.trendSeries([
    { date: '2026-07-01', weightKg: 80 },
    { date: '2026-07-02', weightKg: 79 },
  ]);
  near(daily[1].trendKg, 79.9, 0.01);
  // Non-ISO dates (or duplicates) fall back to a single step, never NaN.
  const weird = E.trendSeries([{ date: 'a', weightKg: 80 }, { date: 'b', weightKg: 79 }]);
  near(weird[1].trendKg, 79.9, 0.01);
});

// ---- item 10: robust slope ----
test('theilSen: recovers the true slope through a single outlier that bends OLS', () => {
  const xs = [], ys = [];
  for (let i = 0; i < 10; i++) { xs.push(i); ys.push(80 - 0.05 * i); }
  ys[5] += 3; // one water-weight spike
  const ts = E.theilSen(xs, ys);
  near(ts.slope, -0.05, 0.02);
  const ols = E.linreg(xs, ys);
  assert.ok(Math.abs(ts.slope + 0.05) < Math.abs(ols.slope + 0.05), 'Theil-Sen beats OLS on the outlier');
  // Degenerate inputs never explode.
  assert.strictEqual(E.theilSen([], []).slope, 0);
  assert.strictEqual(E.theilSen([1, 1], [2, 4]).slope, 0);
});

// ---- item 8 + 12: cycling neutral at the floor, extracted composition ----
test('cyclingDelta: with a floor, low days clamp at the floor and high bumps shrink so the week still nets to base', () => {
  const cfg = { enabled: true, highDays: [0, 1, 2, 3, 4, 5], deltaPct: 0.15 }; // 6 high days
  // Unfloored: low day would be 2000 - 1800 = 200 kcal.
  assert.strictEqual(E.cyclingDelta(cfg, 6, 2000), -1800);
  // Floored at 1200: low day clamps to -800, bumps shrink from 300 to ~133.
  const low = E.cyclingDelta(cfg, 6, 2000, 1200);
  assert.strictEqual(low, -800);
  let sum = 0;
  for (let d = 0; d < 7; d++) sum += E.cyclingDelta(cfg, d, 2000, 1200);
  near(sum, 0, 6); // rounding only
  // A floor that doesn't bind changes nothing.
  assert.strictEqual(E.cyclingDelta({ enabled: true, highDays: [6, 0], deltaPct: 0.15 }, 6, 2000, 1200), E.cyclingDelta({ enabled: true, highDays: [6, 0], deltaPct: 0.15 }, 6, 2000));
});

test('composeDayTarget: low cycling day never lands below the floor', () => {
  const base = { kcal: 1550, protein_g: 150, fat_g: 74, carbs_g: 71 };
  const r = E.composeDayTarget({
    base, date: '2026-07-06', floorKcal: 1500, // 2026-07-06 is a Monday (weekday 1)
    cycling: { enabled: true, highDays: [0, 6], deltaPct: 0.15 }, carryover: null,
    cycleStart: '2026-07-06', eatenByDate: {}, overrideShiftKcal: 0,
  });
  assert.ok(r.eff.kcal >= 1500, `low day ${r.eff.kcal} below floor`);
});

// ---- item 4: carryover fixes ----
test('composeDayTarget: negative carryover disperses an overspend across the remaining days', () => {
  const base = { kcal: 2000, protein_g: 160, fat_g: 74, carbs_g: 174 };
  const r = E.composeDayTarget({
    base, date: '2026-07-04', floorKcal: 1200,
    cycling: null, carryover: { enabled: true, mode: 'dispersed', capKcal: 400 },
    cycleStart: '2026-07-01', eatenByDate: { '2026-07-01': 2500, '2026-07-02': 2300 },
  });
  // Balance -800 over 4 remaining days -> -200 today.
  assert.strictEqual(r.carry, -200);
  near(r.eff.kcal, 1800, 1);
  assert.strictEqual(r.carryDetail.balance, -800);
});

test('composeDayTarget: incomplete logged days are excluded from the carryover balance', () => {
  const base = { kcal: 2000, protein_g: 160, fat_g: 74, carbs_g: 174 };
  const r = E.composeDayTarget({
    base, date: '2026-07-04', floorKcal: 1200,
    cycling: null, carryover: { enabled: true, mode: 'dispersed', capKcal: 400 },
    cycleStart: '2026-07-01',
    eatenByDate: { '2026-07-01': 900, '2026-07-02': 1500 }, // 900 is 45% of target: abandoned, not a real deficit
  });
  assert.strictEqual(r.carryDetail.days.length, 1);
  assert.strictEqual(r.carryDetail.balance, 500); // only the complete day contributes
  assert.strictEqual(r.carry, Math.round(500 / 4));
});

test('composeDayTarget: carryover balance expires beyond day 7 of the cycle', () => {
  const base = { kcal: 2000, protein_g: 160, fat_g: 74, carbs_g: 174 };
  const eaten = {}; for (let i = 0; i < 8; i++) eaten[isoAdd('2026-07-01', i)] = 1400;
  const r = E.composeDayTarget({
    base, date: '2026-07-09', floorKcal: 1200, // day 9 of the cycle
    cycling: null, carryover: { enabled: true, mode: 'dispersed', capKcal: 400 },
    cycleStart: '2026-07-01', eatenByDate: eaten,
  });
  assert.strictEqual(r.carry, 0);
  assert.strictEqual(r.carryDetail.expired, true);
  near(r.eff.kcal, 2000, 1);
});

test('composeDayTarget: cap uses nullish semantics, explicit 0 means no carryover and absent means 400', () => {
  const base = { kcal: 2000, protein_g: 160, fat_g: 74, carbs_g: 174 };
  const mk = (capKcal) => E.composeDayTarget({
    base, date: '2026-07-02', floorKcal: 1200,
    cycling: null, carryover: capKcal === undefined ? { enabled: true, mode: 'aggressive' } : { enabled: true, mode: 'aggressive', capKcal },
    cycleStart: '2026-07-01', eatenByDate: { '2026-07-01': 1300 }, // 700 under target
  });
  assert.strictEqual(mk(0).carry, 0);        // explicit 0 respected (old code turned it into 500)
  assert.strictEqual(mk(undefined).carry, 400); // default aligned to the store's 400
  assert.strictEqual(mk(600).carry, 600);
});

test('composeDayTarget: applies day override shift and reports floorLimited', () => {
  const base = { kcal: 2000, protein_g: 160, fat_g: 74, carbs_g: 174 };
  const r = E.composeDayTarget({ base, date: '2026-07-01', floorKcal: 1200, cycling: null, carryover: null, cycleStart: '2026-07-01', eatenByDate: {}, overrideShiftKcal: 200 });
  assert.strictEqual(r.eff.kcal, 2000);
  near(r.eff.carbs_g, 174 - 200 / 4, 1);
  near(r.eff.fat_g, 74 + 200 / 9, 1);
  assert.strictEqual(r.floorLimited, false);
});

// ---- item 9: plateau detection ----
test('detectPlateau: flags a stalled, adherent cut after >=2 consecutive down-steps', () => {
  const hist = [
    { adhered: true, weeklyChangeKg: -0.4, deltaKcal: -100 },
    { adhered: true, weeklyChangeKg: -0.05, deltaKcal: -150 },
    { adhered: true, weeklyChangeKg: -0.1, deltaKcal: -200 },
  ];
  const r = E.detectPlateau(hist, 'cut');
  assert.strictEqual(r.plateau, true);
  assert.strictEqual(r.cycles, 2);
});

test('detectPlateau: no flag for gains/maintains, off-plan weeks, real movement, or old state shapes', () => {
  const stall = [{ adhered: true, weeklyChangeKg: -0.05, deltaKcal: -150 }, { adhered: true, weeklyChangeKg: -0.1, deltaKcal: -200 }];
  assert.strictEqual(E.detectPlateau(stall, 'gain').plateau, false);
  assert.strictEqual(E.detectPlateau(stall.concat([{ adhered: false, weeklyChangeKg: -0.05, deltaKcal: -150 }]), 'cut').plateau, false);
  assert.strictEqual(E.detectPlateau([{ adhered: true, weeklyChangeKg: -0.5, deltaKcal: -150 }, { adhered: true, weeklyChangeKg: -0.45, deltaKcal: -150 }], 'cut').plateau, false);
  // Old persisted check-ins without the new fields must not crash or flag.
  assert.strictEqual(E.detectPlateau([{ date: '2026-01-01', onTrack: true }, { date: '2026-01-08' }], 'cut').plateau, false);
  assert.strictEqual(E.detectPlateau(null, 'cut').plateau, false);
});

// ---- item 12: extracted check-in pipeline ----
function buildCycleData(opts) {
  // Two 7-day cycles of weights + one cycle of intake, deterministic.
  const { startISO, intake, target, prevKg, slopePerDay } = opts;
  const weights = [], kcalByDate = {}, targetByDate = {};
  for (let i = 0; i < 14; i++) {
    const iso = isoAdd(startISO, i);
    weights.push({ date: iso, kg: +(prevKg + slopePerDay * i).toFixed(2) });
    if (i >= 7) { kcalByDate[iso] = intake; targetByDate[iso] = target; }
  }
  return { weights, kcalByDate, targetByDate, cycleStart: isoAdd(startISO, 7), today: isoAdd(startISO, 13) };
}

test('checkInDecision: needs 3 complete days, incomplete days do not count', () => {
  const d = buildCycleData({ startISO: '2026-06-01', intake: 2000, target: 2000, prevKg: 90, slopePerDay: -0.07 });
  // Corrupt all but two intake days to incomplete.
  Object.keys(d.kcalByDate).forEach((k, i) => { if (i >= 2) d.kcalByDate[k] = 300; });
  const r = E.checkInDecision({
    profile: maleProfile, currentTargets: { kcal: 2000 },
    weights: d.weights, kcalByDate: d.kcalByDate, targetByDate: d.targetByDate,
    cycleStart: d.cycleStart, today: d.today, cycleDays: 7,
    weighDays: 7, minDays: 5, periodDays: 7,
  });
  assert.strictEqual(r.status, 'needdata');
  assert.strictEqual(r.completeDays, 2);
});

test('checkInDecision: normal path uses trend cycle means and returns a proposal with smoothing + plateau info', () => {
  const d = buildCycleData({ startISO: '2026-06-01', intake: 2000, target: 2000, prevKg: 90, slopePerDay: -0.07 });
  const r = E.checkInDecision({
    profile: maleProfile, currentTargets: { kcal: 2000 },
    weights: d.weights, kcalByDate: d.kcalByDate, targetByDate: d.targetByDate,
    cycleStart: d.cycleStart, today: d.today, cycleDays: 7,
    weighDays: 7, minDays: 5, periodDays: 7,
    expenditure: { kcal: 2400, n: 3 }, checkins: [],
  });
  assert.strictEqual(r.status, 'proposed');
  assert.strictEqual(r.completeDays, 7);
  assert.ok(r.estimate && isFinite(r.estimate.tdee));
  assert.ok(r.estimate.weeklyChangeKg < 0, 'losing weight');
  assert.ok(r.expenditure && r.expenditure.n === 4, 'smoothed expenditure advanced');
  assert.ok(r.plateau && typeof r.plateau.plateau === 'boolean');
});

test('checkInDecision: first cycle (no baseline) takes the early path and only gently updates expenditure', () => {
  const weights = [], kcalByDate = {}, targetByDate = {};
  for (let i = 0; i < 7; i++) {
    const iso = isoAdd('2026-06-08', i);
    weights.push({ date: iso, kg: +(90 - 0.3 * i).toFixed(2) }); // crashing fast
    kcalByDate[iso] = 1900; targetByDate[iso] = 1900;
  }
  const r = E.checkInDecision({
    profile: Object.assign({}, maleProfile, { rateKgPerWeek: 0.5 }),
    currentTargets: { kcal: 1900 },
    weights, kcalByDate, targetByDate,
    cycleStart: '2026-06-08', today: '2026-06-14', cycleDays: 7,
    weighDays: 7, minDays: 5, periodDays: 7, earlyCap: 150,
    expenditure: { kcal: 2600, n: 0 },
  });
  assert.strictEqual(r.status, 'proposed');
  assert.strictEqual(r.earlyPhase, true);
  assert.strictEqual(r.direction, 'up');
  assert.ok(r.expenditure && r.expenditure.n === 1);
  // Gentle: the early estimate is water-heavy, so the smoothed value moves only a little.
  assert.ok(Math.abs(r.expenditure.kcal - 2600) < 0.1 * Math.abs(r.estimate.tdee - 2600) + 1);
});

// ---- item 12: multi-cycle convergence simulation ----
test('simulation: expenditure converges to true TDEE over 7 cycles without oscillating', () => {
  // Deterministic PRNG (mulberry32) + Box-Muller gaussian noise.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(42);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());

  const profile = { sex: 'male', weightKg: 90, heightCm: 180, age: 30, avgSteps: 9000, gymSessionsPerWeek: 3, bodyFatPct: 25, dietStyle: 'balanced', goalType: 'cut', rateKgPerWeek: 0.5, weight_unit: 'kg' };
  const formulaTdee = E.tdeeFromProfile(profile);
  const trueTdee = formulaTdee + 300; // the formula underestimates this user by 300 kcal

  let targets = E.computeInitialTargets(profile);
  let expenditure = { kcal: formulaTdee, n: 0 }; // Mifflin-seeded prior
  let trueKg = 90;
  const weights = [], kcalByDate = {}, targetByDate = {};
  const checkins = [], appliedDeltas = [];
  let day = '2026-01-05';

  for (let cycle = 0; cycle < 7; cycle++) {
    const cycleStart = day;
    for (let i = 0; i < 7; i++) {
      const iso = isoAdd(cycleStart, i);
      const intake = targets.kcal; // eats and logs the plan exactly
      trueKg += (intake - trueTdee) / 7700;
      weights.push({ date: iso, kg: +(trueKg + gauss() * 0.25).toFixed(2) }); // scale noise sd 0.25 kg
      kcalByDate[iso] = intake; targetByDate[iso] = intake;
    }
    const today = isoAdd(cycleStart, 6);
    const prof = Object.assign({}, profile, { weightKg: +trueKg.toFixed(2) });
    const dec = E.checkInDecision({
      profile: prof, currentTargets: targets,
      weights, kcalByDate, targetByDate,
      cycleStart, today, cycleDays: 7,
      weighDays: 7, minDays: 5, periodDays: 7, earlyCap: 150,
      expenditure, checkins,
    });
    assert.strictEqual(dec.status, 'proposed', `cycle ${cycle} should produce a decision`);
    if (dec.expenditure) expenditure = dec.expenditure;
    const applied = dec.changed ? dec.deltaKcal : 0;
    appliedDeltas.push(applied);
    checkins.push({ date: today, adhered: true, weeklyChangeKg: dec.estimate ? dec.estimate.weeklyChangeKg : null, deltaKcal: applied });
    if (dec.changed) targets = dec.newTargets; // user approves every proposal
    day = isoAdd(today, 1);
  }

  near(expenditure.kcal, trueTdee, 150); // converged
  for (let i = 1; i < appliedDeltas.length; i++) {
    const a = appliedDeltas[i - 1], b = appliedDeltas[i];
    assert.ok(!((a > 200 && b < -200) || (a < -200 && b > 200)), `oscillation at cycle ${i}: ${a} then ${b}`);
  }
  // And the final target should imply roughly the desired deficit against the true burn.
  near(targets.kcal, trueTdee - 550, 200);
});

// ---- menstrual-cycle awareness ----
test('menstrualPhase: null when off, flags the premenstrual and early-period water window', () => {
  assert.strictEqual(E.menstrualPhase({ enabled: false, lastStart: '2026-07-01', cycleLen: 28 }, '2026-07-10'), null);
  assert.strictEqual(E.menstrualPhase(null, '2026-07-10'), null);
  const cfg = { enabled: true, lastStart: '2026-07-01', cycleLen: 28 };
  assert.strictEqual(E.menstrualPhase(cfg, '2026-07-07').waterHigh, false); // day 6, follicular
  const pre = E.menstrualPhase(cfg, '2026-07-25');                          // day 24, premenstrual week
  assert.strictEqual(pre.waterHigh, true);
  assert.strictEqual(pre.phase, 'luteal');
  assert.strictEqual(E.menstrualPhase(cfg, '2026-07-01').waterHigh, true);  // day 0, early-period bloat
  // Wraps into the next cycle correctly.
  assert.strictEqual(E.menstrualPhase(cfg, '2026-07-29').cycleDay, 0);      // 28 days later = day 0 again
});

test('weeklyAdjust: holds instead of cutting during the water window, but still allows an increase', () => {
  const profile = { goalType: 'cut', rateKgPerWeek: 0.5, weight_unit: 'kg', sex: 'female', age: 30, heightCm: 165, weightKg: 65 };
  const base = { kcal: 2000, protein_g: 150, carbs_g: 180, fat_g: 60 };
  // implied burn 2400 -> desired ~1850, so the engine normally CUTS about 150 kcal
  const optsCut = { profile, currentTargets: base, estimate: { tdee: 2400, weeklyChangeKg: 0.05, avgKcal: 2000, days: 7, band: 50 }, adherenceDays: 7, weighDays: 7, minDays: 5, periodDays: 7 };
  assert.strictEqual(E.weeklyAdjust(optsCut).direction, 'down');
  const held = E.weeklyAdjust(Object.assign({}, optsCut, { waterHigh: true }));
  assert.strictEqual(held.changed, false);
  assert.strictEqual(held.waterHeld, true);
  // An increase (burn 2800 -> desired 2250 > current) is safe and goes through even in the water window.
  const up = E.weeklyAdjust({ profile, currentTargets: base, estimate: { tdee: 2800, weeklyChangeKg: -0.9, avgKcal: 2000, days: 7, band: 50 }, adherenceDays: 7, weighDays: 7, minDays: 5, periodDays: 7, waterHigh: true });
  assert.strictEqual(up.direction, 'up');
  assert.strictEqual(up.changed, true);
});
