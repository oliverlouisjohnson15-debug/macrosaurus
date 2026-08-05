// Week plans: the declared windows the buddy asks about at check-in.
// The rules that matter most here are the protective ones: a declared window must never make the
// plan harder, and must never be the thing that permanently switches someone off their food log.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const plan = (o) => Object.assign({
  id: 'p1', start: '2026-08-10', end: '2026-08-14', kind: 'travel',
  intent: 'push', eating: 'more', moving: 'more', data: 'sparse', acceptRateKgPerWeek: 0.25,
}, o);
const cutter = { goalType: 'cut', rateKgPerWeek: 0.5 };

test('weekPlanOn finds the window covering a date, inclusive of both ends', () => {
  const ps = [plan()];
  assert.equal(E.weekPlanOn(ps, '2026-08-09'), null, 'day before');
  assert.ok(E.weekPlanOn(ps, '2026-08-10'), 'first day');
  assert.ok(E.weekPlanOn(ps, '2026-08-12'), 'middle');
  assert.ok(E.weekPlanOn(ps, '2026-08-14'), 'last day');
  assert.equal(E.weekPlanOn(ps, '2026-08-15'), null, 'day after');
  assert.equal(E.weekPlanOn([], '2026-08-12'), null, 'no plans');
  assert.equal(E.weekPlanOn(null, '2026-08-12'), null, 'null plans');
});

test('plannedDaysBetween counts only the overlap with the cycle', () => {
  const ps = [plan()];
  assert.equal(E.plannedDaysBetween(ps, '2026-08-10', '2026-08-14'), 5, 'exact overlap');
  assert.equal(E.plannedDaysBetween(ps, '2026-08-08', '2026-08-16'), 5, 'window inside cycle');
  assert.equal(E.plannedDaysBetween(ps, '2026-08-12', '2026-08-20'), 3, 'partial overlap');
  assert.equal(E.plannedDaysBetween(ps, '2026-08-20', '2026-08-27'), 0, 'no overlap');
  assert.equal(E.plannedDaysBetween([], '2026-08-10', '2026-08-14'), 0, 'no plans');
});

test('accepting a slower loss raises the daily calories by the deficit given up', () => {
  // 0.5 -> 0.25 kg/wk gives up 0.25 kg of deficit = 0.25 * 7700 / 7 = 275 kcal a day.
  assert.equal(E.planKcalDelta(plan({ acceptRateKgPerWeek: 0.25 }), cutter), 275);
});

test('a hold window eats at maintenance for its whole span', () => {
  // Giving up the entire 0.5 kg/wk deficit = 550 kcal a day back.
  assert.equal(E.planKcalDelta(plan({ intent: 'hold' }), cutter), 550);
});

test('a window never makes the plan harder than normal', () => {
  // Asking to lose FASTER than the standing goal returns no shift rather than a cut.
  assert.equal(E.planKcalDelta(plan({ acceptRateKgPerWeek: 0.9 }), cutter), 0);
  assert.equal(E.planKcalDelta(plan({ acceptRateKgPerWeek: 0.5 }), cutter), 0, 'same as normal is a no-op');
});

test('on a gain goal, easing off means eating LESS not more', () => {
  const gainer = { goalType: 'gain', rateKgPerWeek: 0.25 };
  const d = E.planKcalDelta(plan({ intent: 'hold' }), gainer);
  assert.ok(d < 0, 'giving up a surplus lowers calories, got ' + d);
  assert.equal(d, -275);
});

test('a maintain goal is untouched by a window', () => {
  assert.equal(E.planKcalDelta(plan({ intent: 'hold' }), { goalType: 'maintain', rateKgPerWeek: 0 }), 0);
});

test('no plan means no shift at all', () => {
  assert.equal(E.planKcalDelta(null, cutter), 0);
});

// ---- big days inside a window ----------------------------------------------------------------
test('a big day is paid for by the other days in the window', () => {
  // 5-day window, one high day, 25% boost on a 2000 kcal base = +500 on the day.
  const pl = plan({ highDays: ['2026-08-12'], deltaPct: 0.25, acceptRateKgPerWeek: 0.5 });
  const hi = E.planDayDelta(pl, cutter, '2026-08-12', 2000);
  const lo = E.planDayDelta(pl, cutter, '2026-08-11', 2000);
  assert.equal(hi, 500, 'the big day gets the boost');
  assert.equal(lo, -125, 'the other four days each give up a quarter of it');
  // And it nets to zero across the window, so the agreed rate still lands.
  const total = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
    .reduce((s, d) => s + E.planDayDelta(pl, cutter, d, 2000), 0);
  assert.equal(total, 0);
});

test('a big day stacks on top of an eased rate without cancelling it', () => {
  const pl = plan({ highDays: ['2026-08-12'], deltaPct: 0.25, acceptRateKgPerWeek: 0.25 });
  // Flat shift is +275 for the whole window; the big day adds its boost on top.
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-12', 2000), 275 + 500);
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-11', 2000), 275 - 125);
});

test('no big days means the flat window shift, unchanged', () => {
  const pl = plan({ acceptRateKgPerWeek: 0.25 });
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-12', 2000), E.planKcalDelta(pl, cutter));
});

test('a single-day window that IS the big day just gets the flat shift', () => {
  // Nothing left to pay for it, so the boost is dropped rather than inventing calories.
  const pl = plan({ start: '2026-08-12', end: '2026-08-12', highDays: ['2026-08-12'], acceptRateKgPerWeek: 0.25 });
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-12', 2000), 275);
});

test('recovery runs for as long as the window did, capped at a week', () => {
  const ps = [plan()]; // 5 days, so a 5-day ease-back
  assert.ok(E.planRecoveryOn(ps, '2026-08-15'), 'day after the window');
  assert.ok(E.planRecoveryOn(ps, '2026-08-19'), 'last easing day');
  assert.equal(E.planRecoveryOn(ps, '2026-08-20'), null, 'past the easing window');
  assert.equal(E.planRecoveryOn(ps, '2026-08-12'), null, 'inside the window is not recovery');
  // A 30-day window still only eases for 7.
  const long = [plan({ start: '2026-07-01', end: '2026-07-30' })];
  assert.ok(E.planRecoveryOn(long, '2026-08-06'), '7 days after');
  assert.equal(E.planRecoveryOn(long, '2026-08-07'), null, 'capped at 7');
});

test('context reports water-high inside a window and through its recovery', () => {
  const ps = [plan()];
  assert.equal(E.weekPlanContext(ps, '2026-08-09').waterHigh, false, 'before');
  assert.equal(E.weekPlanContext(ps, '2026-08-12').waterHigh, true, 'during');
  assert.equal(E.weekPlanContext(ps, '2026-08-16').waterHigh, true, 'recovering');
  assert.equal(E.weekPlanContext(ps, '2026-08-25').waterHigh, false, 'long after');
  assert.equal(E.weekPlanContext([], '2026-08-12').waterHigh, false, 'no plans');
});

// ---- the protective guard, which is the whole point of phase 3 -------------------------------
// Two under-reporting cycles running normally switch a user permanently onto weight-only steering.
// A declared window is the likeliest cause of exactly that disagreement, so it must be exempt.
function underReportOpts(extra) {
  const cs = '2026-08-01', today = '2026-08-08';
  const iso = (m, d) => new Date(Date.UTC(2026, m, d)).toISOString().slice(0, 10);
  const kcalByDate = {}, targetByDate = {};
  for (let i = 0; i < 8; i++) {
    // Logged above the 60% completeness bar, but low enough that a flat scale implies an
    // expenditure below BMR (1810 here), which is what raises the under-reporting flag.
    kcalByDate[iso(7, 1 + i)] = 1400;
    targetByDate[iso(7, 1 + i)] = 2200;
  }
  const weights = [];
  for (let i = 0; i < 7; i++) weights.push({ date: iso(6, 25 + i), kg: 85.0 }); // previous cycle
  for (let i = 0; i < 8; i++) weights.push({ date: iso(7, 1 + i), kg: 85.0 });  // this cycle, flat
  return Object.assign({
    cycleStart: cs, today: today, cycleDays: 8,
    kcalByDate, targetByDate,
    profile: { goalType: 'cut', rateKgPerWeek: 0.5, sex: 'male', weightKg: 85, heightCm: 180, age: 34, bodyFatPct: 22 },
    currentTargets: { kcal: 2200, protein_g: 180, carbs_g: 200, fat_g: 70 },
    weights: weights, weighDays: 8, minDays: 4,
    checkins: [{ date: '2026-08-01', underReport: true }],   // previous cycle already flagged
  }, extra);
}

test('the fixture really does reach the lane switch (guards the two tests below)', () => {
  const r = E.checkInDecision(underReportOpts());
  assert.equal(r.status, 'proposed', 'must not bail out at needdata');
  assert.equal(r.underReportFlagged, true, 'must actually flag under-reporting');
});

test('without a declared window, two flagged cycles still switch to weight-only', () => {
  // Pre-existing behaviour, preserved exactly.
  assert.equal(E.checkInDecision(underReportOpts()).laneSwitched, 'weightOnly');
});

test('a declared window never triggers the permanent lane switch', () => {
  const r = E.checkInDecision(underReportOpts({ plannedDays: 5 }));
  assert.notEqual(r.laneSwitched, 'weightOnly', 'a holiday must not switch how the app steers');
});

test('a user with no week plans gets a byte-identical decision', () => {
  // The regression guard: plannedDays absent and plannedDays: 0 must be indistinguishable.
  const a = E.checkInDecision(underReportOpts());
  const b = E.checkInDecision(underReportOpts({ plannedDays: 0 }));
  assert.deepEqual(b, a);
});
