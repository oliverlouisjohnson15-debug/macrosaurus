/* Node unit tests for engine.js v2 — run: node engine.test.cjs */
const E = require('./engine.js');
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  -> ' + x : '')); } }
function approx(a, b, t) { return Math.abs(a - b) <= (t == null ? 1 : t); }

console.log('Mifflin BMR');
ok('male 75/175/32 = 1688.75', approx(E.mifflinBMR({ sex: 'male', weightKg: 75, heightCm: 175, age: 32 }), 1688.75, 0.01));

console.log('TDEE from steps + gym');
var p = { sex: 'male', weightKg: 75, heightCm: 175, age: 32, avgSteps: 8000, gymSessionsPerWeek: 4 };
var bd = E.tdeeBreakdown(p);
ok('steps kcal ~342 (8000 @75kg)', approx(bd.stepsKcal, 8000 * 0.00057 * 75, 1), 'got ' + bd.stepsKcal);
ok('gym kcal/day matches constant', approx(bd.gymKcal, (4 * E.KCAL_PER_GYM_SESSION_PER_KG * 75) / 7, 1), 'got ' + bd.gymKcal);
ok('tdee = resting+steps+gym', approx(bd.tdee, bd.resting + bd.stepsKcal + bd.gymKcal, 1), 'got ' + bd.tdee);
ok('more steps => higher tdee', E.tdeeFromProfile({ ...p, avgSteps: 14000 }) > bd.tdee);

console.log('Protein is moderate (fixes the 180g problem)');
var prof = { ...p, bodyFatPct: 18, goalType: 'cut', rateKgPerWeek: 0.5, dietStyle: 'balanced' };
ok('default 1.8 g/kg BW = 135g @75kg', E.proteinGrams(prof) === Math.round(1.8 * 75), 'got ' + E.proteinGrams(prof));
ok('manual gram target respected', E.proteinGrams({ ...prof, proteinManualG: 150 }) === 150);
ok('custom g/kg respected', E.proteinGrams({ ...prof, proteinGPerKgBW: 2.0 }) === 150);

console.log('Initial targets');
var t = E.computeInitialTargets(prof);
ok('has no ranges (removed)', t.ranges === undefined);
ok('macros reconstruct kcal', approx(t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9, t.kcal, 12), (t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9) + ' vs ' + t.kcal);
ok('cut target below TDEE', t.kcal < t.estimatedTDEE);

console.log('Calorie cycling keeps the weekly total constant');
var cfg = { enabled: true, highDays: [6, 0], deltaPct: 0.2 }; // Sat + Sun high
var base = 2000, weekSum = 0;
for (var d = 0; d < 7; d++) weekSum += base + E.cyclingDelta(cfg, d, base);
ok('week sum ~= 7*base', approx(weekSum, 7 * base, 1), 'got ' + weekSum);
ok('high day gets +400', E.cyclingDelta(cfg, 6, base) === 400, 'got ' + E.cyclingDelta(cfg, 6, base));
ok('low day is negative', E.cyclingDelta(cfg, 3, base) < 0);
ok('disabled => 0', E.cyclingDelta({ enabled: false }, 3, base) === 0);

console.log('Carryover banks surplus/deficit (capped)');
ok('undereat -> add next day', E.carryover(2000, 1700, 500) === 300);
ok('overeat -> subtract next day', E.carryover(2000, 2300, 500) === -300);
ok('capped', E.carryover(2000, 1000, 400) === 400);

console.log('applyKcalDelta flexes carbs, holds protein/fat');
var baseT = { kcal: 2000, protein_g: 150, fat_g: 60, carbs_g: 215 }; // consistent: 600+540+860=2000
var eff = E.applyKcalDelta(baseT, 300);
ok('kcal +300', eff.kcal === 2300);
ok('protein/fat unchanged', eff.protein_g === 150 && eff.fat_g === 60);
ok('carbs absorb the +300 (~+75g)', approx(eff.carbs_g - baseT.carbs_g, 75, 2), 'delta ' + (eff.carbs_g - baseT.carbs_g));

console.log('Adaptive weekly adjust + guards');
var cur = E.computeInitialTargets(prof);
var est = { tdee: 3000, avgKcal: 2100, weeklyChangeKg: -0.8, days: 7 };
var adj = E.weeklyAdjust({ profile: prof, currentTargets: cur, estimate: est, adherenceDays: 7 });
ok('adjusts, capped <=150', adj.changed && Math.abs(adj.deltaKcal) <= 150);
ok('low adherence guard', E.weeklyAdjust({ profile: prof, currentTargets: cur, estimate: est, adherenceDays: 3 }).changed === false);
ok('under-report guard', E.weeklyAdjust({ profile: prof, currentTargets: cur, estimate: { tdee: 1500, avgKcal: 1400, weeklyChangeKg: 0, days: 7 }, adherenceDays: 7 }).underReportFlagged === true);

console.log('Daily steps: average over days with a reading');
var stepMap = { '2026-07-01': 8000, '2026-07-02': 0, '2026-07-03': 10000, '2026-07-05': 6000 };
var sr = E.avgStepsInRange(stepMap, '2026-07-01', '2026-07-07');
ok('averages only days with steps (8000 avg over 3 days)', sr && sr.avg === 8000 && sr.days === 3, sr && (sr.avg + '/' + sr.days));
ok('out-of-range excluded', E.avgStepsInRange(stepMap, '2026-07-10', '2026-07-20') === null);
ok('null map is safe', E.avgStepsInRange(null, '2026-07-01', '2026-07-07') === null);

console.log('Steps-first coaching lever');
var scDrop = E.stepsCoaching({ thisCycle: { avg: 5000, days: 6 }, prevCycle: { avg: 9000, days: 7 }, baseline: 9000, behindTarget: true });
ok('slow week + steps dropped => lever steps', scDrop.lever === 'steps', scDrop.lever);
ok('steps drop flagged', scDrop.droppedVsPrev === true && scDrop.belowBaseline === true);
ok('suggests a target back up towards usual', scDrop.suggestTarget >= 9000, 'got ' + scDrop.suggestTarget);
var scSolid = E.stepsCoaching({ thisCycle: { avg: 9500, days: 7 }, prevCycle: { avg: 9200, days: 7 }, baseline: 9000, behindTarget: true });
ok('slow week + steps solid => lever calories', scSolid.lever === 'calories', scSolid.lever);
ok('solid steps => no suggested step target', scSolid.suggestTarget === null);
var scOnTrack = E.stepsCoaching({ thisCycle: { avg: 5000, days: 6 }, prevCycle: { avg: 9000, days: 7 }, baseline: 9000, behindTarget: false });
ok('on-target week => lever none (no nagging)', scOnTrack.lever === 'none');
ok('no step data => hasData false', E.stepsCoaching({ thisCycle: null, baseline: 9000, behindTarget: true }).hasData === false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
