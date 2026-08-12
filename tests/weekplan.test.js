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

test('the boost is capped by what the low days can actually give up', () => {
  // A small person on 1400 kcal with a 1200 floor: five big days out of seven cannot be paid for by
  // two low days at 35%. Left uncapped the low days demanded 175 kcal, composeDayTarget clamped them
  // back to the floor, and the WEEK silently came out 2050 kcal above the rate the user agreed to,
  // while the screen promised "the others cover it, so the week still adds up".
  const p = { goalType: 'cut', rateKgPerWeek: 0.5 };
  const pl = plan({
    start: '2026-08-10', end: '2026-08-16', acceptRateKgPerWeek: 0.5, deltaPct: 0.35,
    highDays: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'],
  });
  const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'];
  const deltas = days.map(d => E.planDayDelta(pl, p, d, 1400, 1200));
  deltas.forEach((dl, i) => assert.ok(1400 + dl >= 1200, days[i] + ' fell below the floor at ' + (1400 + dl)));
  assert.equal(deltas.reduce((a, b) => a + b, 0), 0, 'the window must still net to zero');
});

test('an uncapped boost still applies when the low days can afford it', () => {
  // Plenty of headroom above the floor, so nothing is clamped and the full boost lands.
  const p = { goalType: 'cut', rateKgPerWeek: 0.5 };
  const pl = plan({ highDays: ['2026-08-12'], deltaPct: 0.25, acceptRateKgPerWeek: 0.5 });
  assert.equal(E.planDayDelta(pl, p, '2026-08-12', 2800, 1200), 700);
  assert.equal(E.planDayDelta(pl, p, '2026-08-11', 2800, 1200), -175);
});

// ---- settling up after the trip, not inside it -----------------------------------------------
// Four big days of a five-day trip leave ONE day to pay for all four, and it lands on the floor.
// The accounting period people have in mind is the week that ends at the weigh-in, so the days
// between coming home and standing on the scales take a share too.
test('without a settle date the window still settles inside itself', () => {
  const pl = plan({ highDays: ['2026-08-12'], deltaPct: 0.25, acceptRateKgPerWeek: 0.25 });
  const bare = E.planDayDelta(pl, cutter, '2026-08-10', 2000);
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-10', 2000, null, null), bare, 'null settle date');
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-10', 2000, null, '2026-08-13'), bare, 'one inside the window');
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-10', 2000, null, '2026-08-14'), bare, 'one on the last day');
});

test('the days settling up share the bill equally with the low days still away', () => {
  // Away 10-14 easing to 0.25 kg/wk (+275/day), Wed 12 the big day, weigh-in after the 16th.
  const pl = plan({ highDays: ['2026-08-12'], deltaPct: 0.25, acceptRateKgPerWeek: 0.25 });
  const d = (iso) => E.planDayDelta(pl, cutter, iso, 2000, null, '2026-08-16');
  assert.equal(d('2026-08-12'), 775, 'the big day takes the eased rate and the boost');
  // Every day paying for it lands on the same number, whether it is a day away or a day home.
  ['2026-08-10', '2026-08-11', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']
    .forEach(iso => assert.equal(d(iso), 100, iso + ' should match every other paying day'));
});

test('spreading the bill wider does not change what the span adds up to', () => {
  const pl = plan({ highDays: ['2026-08-12'], deltaPct: 0.25, acceptRateKgPerWeek: 0.25 });
  const span = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'];
  const total = span.reduce((s, iso) => s + E.planDayDelta(pl, cutter, iso, 2000, null, '2026-08-16'), 0);
  // Five days away at +275 is the whole of the deal; the shape moves it about and adds nothing.
  assert.equal(total, 5 * 275);
});

test('a settling day is a day at home, so it never takes the eased rate on its own', () => {
  // No big days at all: the days away are lifted and the days after are left entirely alone.
  const pl = plan({ highDays: [], acceptRateKgPerWeek: 0.25 });
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-14', 2000, null, '2026-08-16'), 275, 'last day away');
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-15', 2000, null, '2026-08-16'), 0, 'home, nothing to pay');
  assert.equal(E.planDayDelta(pl, cutter, '2026-08-16', 2000, null, '2026-08-16'), 0);
});

test('the boost gives way rather than pushing the settling days under the floor', () => {
  // Three days away, all three big, four days at home to pay for them on a 1400 base.
  const pl = plan({
    start: '2026-08-10', end: '2026-08-12', acceptRateKgPerWeek: 0.5, deltaPct: 0.35,
    highDays: ['2026-08-10', '2026-08-11', '2026-08-12'],
  });
  const span = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'];
  const d = (iso) => E.planDayDelta(pl, cutter, iso, 1400, 1200, '2026-08-16');
  span.forEach(iso => assert.ok(1400 + d(iso) >= 1200, iso + ' fell to ' + (1400 + d(iso))));
  assert.ok(d('2026-08-10') < Math.round(1400 * 0.35), 'the asked-for boost was cut down to fit');
  assert.ok(Math.abs(span.reduce((s, iso) => s + d(iso), 0)) <= 4, 'and it still nets out');
});

// ---- editing the shape of a window while it runs ---------------------------------------------
// The shape inside a window is editable from Weekly shape, which is what makes this reachable at
// all: before that, highDays were written once at check-in and never touched. The promise these
// tests hold the code to is the one the standing rhythm already makes (see cyclingHistory): a day
// you have already eaten keeps the target it ran under.
const HIST = (o) => Object.assign({ from: '2026-08-10', to: '2026-08-11', deltaPct: 0.25 }, o);
const shaped = (o) => plan(Object.assign({ acceptRateKgPerWeek: 0.5, deltaPct: 0.25 }, o));
const dd = (pl, iso) => E.planDayDelta(pl, cutter, iso, 2000);
const WEEK = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];
const windowTotal = (pl) => WEEK.reduce((s, d) => s + dd(pl, d), 0);

test('with no history the live shape governs the whole window, exactly as before', () => {
  const pl = shaped({ highDays: ['2026-08-12'] });
  assert.equal(dd(pl, '2026-08-12'), 500);
  assert.equal(dd(pl, '2026-08-11'), -125);
  assert.equal(windowTotal(pl), 0, 'still nets to the agreed rate');
  assert.deepEqual(E.planShapeOn(pl, '2026-08-12').highDays, ['2026-08-12']);
});

test('moving a big day that is still ahead leaves the eaten days exactly where they were', () => {
  // Ran Mon-Tue under "Thu is the big day", then on Wed it was moved to Fri.
  const before = shaped({ highDays: ['2026-08-13'] });
  const after = shaped({
    highDays: ['2026-08-14'],
    shapeHistory: [HIST({ highDays: ['2026-08-13'] })],
  });
  assert.equal(dd(after, '2026-08-10'), dd(before, '2026-08-10'), 'Mon is untouched');
  assert.equal(dd(after, '2026-08-11'), dd(before, '2026-08-11'), 'Tue is untouched');
  assert.equal(dd(after, '2026-08-14'), 500, 'Friday is the big day now');
  assert.equal(dd(after, '2026-08-13'), -125, 'Thursday went back to paying in');
  assert.equal(windowTotal(after), 0, 'and the agreed rate still lands across the edit');
});

test('adding a second big day does not re-bill the days already eaten', () => {
  // THE test. Redistribution divides the boost by how many big days there are, so without the dated
  // record Monday would silently go from -125 to -333 to help pay for a Friday it never knew about.
  const before = shaped({ highDays: ['2026-08-11'] });
  const after = shaped({
    highDays: ['2026-08-11', '2026-08-14'],
    shapeHistory: [HIST({ highDays: ['2026-08-11'] })],
  });
  assert.equal(dd(before, '2026-08-10'), -125, 'what Monday ran under');
  assert.equal(dd(after, '2026-08-10'), -125, 'and what it still reads at');
  assert.equal(dd(after, '2026-08-11'), 500, 'Tuesday was big and stays big');
  assert.equal(dd(after, '2026-08-13'), -333, 'only the days from the edit on carry the new split');
  // Two big days really were eaten, so the window honestly runs over rather than pretending
  // otherwise by rewriting Monday. Small, bounded, and the truthful answer.
  assert.ok(windowTotal(after) > 0, 'runs over');
  assert.ok(windowTotal(after) < 800, 'but by less than one big day, got ' + windowTotal(after));
});

test('moving the boost slider mid-window does not restate the eaten days either', () => {
  const before = shaped({ highDays: ['2026-08-14'], deltaPct: 0.30 });
  const after = shaped({
    highDays: ['2026-08-14'], deltaPct: 0.10,
    shapeHistory: [HIST({ highDays: ['2026-08-14'], deltaPct: 0.30 })],
  });
  assert.equal(dd(after, '2026-08-10'), dd(before, '2026-08-10'), 'Monday keeps the 30% it paid');
  assert.equal(dd(after, '2026-08-14'), 200, 'Friday takes the new 10%');
});

test('a recorded shape is picked by date, and days outside every record take the live one', () => {
  const pl = shaped({
    highDays: ['2026-08-14'],
    shapeHistory: [HIST({ highDays: ['2026-08-13'] })],
  });
  assert.deepEqual(E.planShapeOn(pl, '2026-08-10').highDays, ['2026-08-13'], 'inside the record');
  assert.deepEqual(E.planShapeOn(pl, '2026-08-11').highDays, ['2026-08-13'], 'last day of the record');
  assert.deepEqual(E.planShapeOn(pl, '2026-08-12').highDays, ['2026-08-14'], 'the day after takes the live shape');
  assert.deepEqual(E.planShapeOn(pl, '2026-08-14').highDays, ['2026-08-14']);
});

test('a high day recorded outside the window is ignored rather than paid for', () => {
  const pl = shaped({ highDays: ['2026-09-01'] });
  assert.equal(dd(pl, '2026-08-12'), 0, 'no big day inside the window means no redistribution');
  assert.equal(windowTotal(pl), 0);
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

// ---- declared but not started yet ------------------------------------------------------------
// A window declared at check-in is nearly always for NEXT week. Nothing used to surface it until the
// day it began, so the app looked like it had thrown the declaration away.
test('upcomingPlanOn finds a declared window before it starts, and only before', () => {
  const ps = [plan()];   // 2026-08-10 to 2026-08-14
  assert.ok(E.upcomingPlanOn(ps, '2026-08-03'), 'a week out');
  assert.ok(E.upcomingPlanOn(ps, '2026-08-09'), 'the day before');
  assert.equal(E.upcomingPlanOn(ps, '2026-08-10'), null, 'the first day is running, not upcoming');
  assert.equal(E.upcomingPlanOn(ps, '2026-08-12'), null, 'mid-window');
  assert.equal(E.upcomingPlanOn(ps, '2026-08-20'), null, 'after');
  assert.equal(E.upcomingPlanOn([], '2026-08-03'), null, 'no plans');
  assert.equal(E.upcomingPlanOn(null, '2026-08-03'), null, 'null plans');
});

test('upcomingPlanOn stays quiet about windows too far off to act on', () => {
  const ps = [plan()];
  assert.ok(E.upcomingPlanOn(ps, '2026-07-27'), '14 days out is still worth saying');
  assert.equal(E.upcomingPlanOn(ps, '2026-07-26'), null, '15 days out is not');
  assert.ok(E.upcomingPlanOn(ps, '2026-07-26', 30), 'unless asked to look further');
});

test('upcomingPlanOn picks the nearest window, whatever order they were declared in', () => {
  const near = plan({ id: 'near', start: '2026-08-10', end: '2026-08-14' });
  const far = plan({ id: 'far', start: '2026-08-20', end: '2026-08-22' });
  assert.equal(E.upcomingPlanOn([far, near], '2026-08-05', 30).id, 'near');
  assert.equal(E.upcomingPlanOn([near, far], '2026-08-05', 30).id, 'near');
  // Once the near one is running it is no longer "upcoming", but the far one still is.
  assert.equal(E.upcomingPlanOn([near, far], '2026-08-12', 30).id, 'far');
});

test('context offers an upcoming window, but never over one that is actually running', () => {
  const ps = [plan()];
  const before = E.weekPlanContext(ps, '2026-08-08');
  assert.ok(before.upcoming, 'declared and not started');
  assert.equal(before.active, null);
  const during = E.weekPlanContext(ps, '2026-08-12');
  assert.ok(during.active, 'running');
  assert.equal(during.upcoming, null, 'what is happening today wins');
  assert.equal(E.weekPlanContext(ps, '2026-08-16').upcoming, null, 'recovering, nothing ahead');
  assert.equal(E.weekPlanContext([], '2026-08-08').upcoming, null, 'no plans');
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

// ---- streak: bridge, never award -------------------------------------------------------------
const Game = require('../app/game.js');
test('a declared window bridges a streak without inflating it', () => {
  const active = new Set(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-08']);
  const planned = new Set(['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
  const r = Game.computeStreak(active, new Set(), '2026-08-08', planned);
  assert.equal(r.streak, 4, 'four days actually shown up for, bridged across the trip');
  assert.equal(r.newFrozen.length, 0, 'and the trip must not spend the monthly freeze');
});

test('without the window the same gap breaks the run', () => {
  const active = new Set(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-08']);
  assert.equal(Game.computeStreak(active, new Set(), '2026-08-08').streak, 1);
});

test('computeStreak is unchanged for anyone with no plans', () => {
  const active = new Set(['2026-08-06', '2026-08-07', '2026-08-08']);
  const a = Game.computeStreak(active, new Set(), '2026-08-08');
  const b = Game.computeStreak(active, new Set(), '2026-08-08', new Set());
  assert.deepEqual(b, a);
});

// ---- precedence: a diet break outranks a window ------------------------------------------------
test('hold is honoured from the new flag and the legacy intent alike', () => {
  const p = { goalType: 'cut', rateKgPerWeek: 0.5 };
  assert.equal(E.planKcalDelta({ hold: true }, p), 550, 'new flag');
  assert.equal(E.planKcalDelta({ intent: 'hold' }, p), 550, 'plans saved before the collapse');
});

// ---- phase 7: recurrence, and its refusals -----------------------------------------------------
// The refusals matter more than the detections here: an app that guesses your life out loud and
// gets it wrong is worse than one that stays quiet.
const mk = (kind, start, end, rate) => ({ id: start, kind, label: kind, start, end, acceptRateKgPerWeek: rate, data: 'sparse' });

test('spots a genuine monthly rhythm when the next one is close', () => {
  const ps = [mk('travel', '2026-05-04', '2026-05-08', 0.25), mk('travel', '2026-06-01', '2026-06-05', 0.25), mk('travel', '2026-07-06', '2026-07-10', 0.25)];
  const h = E.recurringPlanHint(ps, '2026-08-01');
  assert.ok(h, 'expected a hint');
  assert.equal(h.kind, 'travel');
  assert.equal(h.count, 3);
  assert.equal(h.spanDays, 5, 'carries the typical length');
  assert.equal(h.acceptRateKgPerWeek, 0.25, 'and what they settled on last time');
});

test('stays quiet on only two occurrences', () => {
  const ps = [mk('travel', '2026-06-01', '2026-06-05', 0.25), mk('travel', '2026-07-01', '2026-07-05', 0.25)];
  assert.equal(E.recurringPlanHint(ps, '2026-08-01'), null, 'two is a coincidence, not a pattern');
});

test('stays quiet when the gaps disagree with each other', () => {
  // March, then August, then September: no honest rhythm to speak of.
  const ps = [mk('travel', '2026-03-01', '2026-03-05', 0.25), mk('travel', '2026-08-01', '2026-08-05', 0.25), mk('travel', '2026-09-01', '2026-09-05', 0.25)];
  assert.equal(E.recurringPlanHint(ps, '2026-10-01'), null);
});

test('stays quiet when the next one is not due for ages', () => {
  const ps = [mk('travel', '2026-01-05', '2026-01-09', 0.25), mk('travel', '2026-02-02', '2026-02-06', 0.25), mk('travel', '2026-03-02', '2026-03-06', 0.25)];
  assert.equal(E.recurringPlanHint(ps, '2026-08-01'), null, 'months past due is not a prompt');
});

test('ignores windows that have not happened yet', () => {
  const ps = [mk('travel', '2026-05-04', '2026-05-08', 0.25), mk('travel', '2026-06-01', '2026-06-05', 0.25), mk('travel', '2026-12-01', '2026-12-05', 0.25)];
  assert.equal(E.recurringPlanHint(ps, '2026-08-01'), null, 'a future booking is not evidence of a habit');
});

test('no plans, no hint', () => {
  assert.equal(E.recurringPlanHint([], '2026-08-01'), null);
  assert.equal(E.recurringPlanHint(null, '2026-08-01'), null);
});
