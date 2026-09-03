'use strict';
/* The cycle strip on Today.
 *
 * Progress was moved off the tab bar on the argument that nothing daily was lost, because the
 * verdict, the spark and the check-in prompt were all on Today already. They were not - the card
 * that carried them had been deleted - and nothing noticed for as long as it took somebody to say
 * the screen felt like it had no progress on it. So the state machine is tested here rather than
 * left inside a component, and the four states are rendered and read.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');
const { app, render } = require('./helpers/app.js');

const A = app();
const Store = A.Store;
const iso = (back) => A.shiftISO(Store.todayISO(), -back);

// ---- the decision ------------------------------------------------------------------------------

test('with no verdict there is nothing to be due about', () => {
  assert.equal(E.cycleStripState({}), 'empty');
  assert.equal(E.cycleStripState({ verdict: null, checkin: { due: true } }), 'empty');
  assert.equal(E.cycleStripState({ verdict: null, coverage: { logWindow: 9, logged: 0, weighed: 0 } }), 'empty');
});

test('a due check-in outranks a thin read, because checking in is what fixes it', () => {
  const thin = { logWindow: 9, logged: 1, weighed: 0 };
  assert.equal(E.cycleStripState({ verdict: {}, coverage: thin }), 'thin');
  assert.equal(E.cycleStripState({ verdict: {}, checkin: { due: true }, coverage: thin }), 'due');
});

test('a young cycle is a new cycle, not thin data', () => {
  // The morning after a check-in: one day, nothing logged on it yet. The verdict is read off three
  // weeks of trend and has not moved, so calling it rough here would undercut a sound read.
  assert.equal(E.cycleStripState({ verdict: {}, coverage: { logWindow: 1, logged: 0, weighed: 0 } }), 'rest');
  assert.equal(E.cycleStripState({ verdict: {}, coverage: { logWindow: 3, logged: 0, weighed: 0 } }), 'rest');
  // Four days in, the same coverage is genuinely thin.
  assert.equal(E.cycleStripState({ verdict: {}, coverage: { logWindow: 4, logged: 0, weighed: 0 } }), 'thin');
});

test('thin is either half a log or a scale nobody stood on', () => {
  assert.equal(E.cycleStripState({ verdict: {}, coverage: { logWindow: 7, logged: 3, weighed: 5 } }), 'thin');
  assert.equal(E.cycleStripState({ verdict: {}, coverage: { logWindow: 7, logged: 7, weighed: 1 } }), 'thin');
  assert.equal(E.cycleStripState({ verdict: {}, coverage: { logWindow: 7, logged: 5, weighed: 2 } }), 'rest');
});

// ---- the strip ---------------------------------------------------------------------------------

// An account three weeks into a 0.5 kg/wk cut, losing 0.4, weighed most mornings and logged daily.
function cutting(extra) {
  const weights = [], logs = [];
  for (let i = 27; i >= 0; i--) {
    const d = iso(i);
    weights.push({ id: 'w' + i, date: d, scale_weight: +(87.0 - (27 - i) * 0.058).toFixed(2) });
    logs.push({ id: 'l' + i, date: d, meal: 'Lunch', computed_macros: { kcal: 2100, protein: 170, carbs: 200, fat: 60 } });
  }
  const db = Object.assign({
    profile: { sex: 'male', age: 32, heightCm: 175, weightKg: 85.4, bodyFatPct: 22, goalType: 'cut',
      rateKgPerWeek: 0.5, goalWeightKg: 78, weight_unit: 'kg', dietStyle: 'balanced', activity: 'moderate' },
    weight_entries: weights, log_entries: logs, targets: [], week_plans: [], day_overrides: {},
    last_checkin: iso(3), paused: false,
  }, extra || {});
  A.recomputeTrend(db);
  return db;
}

const strip = (db) => render(A.CycleStrip, { db, onOpen() {}, onCheckIn() {}, onWeigh() {} });

test('at rest it says the verdict, the trend weight and the rate against the target', () => {
  const r = strip(cutting());
  assert.ok(r.has('This cycle'), 'the strip should name itself: ' + r.text.slice(0, 160));
  assert.ok(/kg/.test(r.text), 'the trend weight should be on it: ' + r.text.slice(0, 160));
  assert.ok(/target 0\.5 kg/.test(r.text), 'and what it is being judged against: ' + r.text.slice(0, 200));
  // At rest it is one row and nothing else: no caveat, no button.
  assert.ok(!r.has('Check in'), 'nothing is due, so nothing should be asked for: ' + r.text.slice(0, 200));
  assert.ok(!r.has('rough read'), 'a well-covered cycle is not a rough read: ' + r.text.slice(0, 200));
});

test('the verdict it shows is the one Progress shows', () => {
  const db = cutting();
  const v = A.progressVerdict(db);
  assert.ok(v && v.headline, 'the fixture should produce a verdict at all');
  assert.ok(strip(db).has(v.headline), 'the strip and Progress must not disagree about the headline');
});

test('a due check-in puts the button on Today, not three taps away', () => {
  const r = strip(cutting({ last_checkin: iso(9) }));
  assert.ok(r.has('Weekly check-in due'), 'it should say so: ' + r.text.slice(0, 200));
  assert.ok(r.has('Check in'), 'and offer it: ' + r.text.slice(0, 200));
});

test('a paused plan is never asked to check in', () => {
  // Progress hides its check-in card while paused, so a strip that asked here would be offering an
  // action the page it opens refuses.
  const r = strip(cutting({ last_checkin: iso(9), paused: true }));
  assert.ok(!r.has('Weekly check-in due'), 'paused means no check-in: ' + r.text.slice(0, 200));
});

test('a thin cycle carries its caveat rather than claiming certainty', () => {
  // Five days since the last check-in, so the cycle is old enough to be judged but not yet due -
  // and nothing logged or weighed in any of them. The verdict still reads off the three weeks of
  // trend behind it; what it cannot do is claim that read is well covered.
  const db = cutting({ last_checkin: iso(5) });
  db.log_entries = db.log_entries.filter(e => e.date <= iso(6));
  db.weight_entries = db.weight_entries.filter(e => e.date <= iso(6));
  const r = strip(db);
  assert.ok(r.has('rough read'), 'a patchy cycle should say so: ' + r.text.slice(0, 260));
  assert.ok(!r.has('Weekly check-in due'), 'five days in is not due yet: ' + r.text.slice(0, 260));
});

test('a fresh account is asked for the one thing that would give it something to say', () => {
  const db = cutting();
  db.weight_entries = []; db.log_entries = [];
  const r = strip(db);
  assert.ok(r.has('No read yet'), 'it should admit it: ' + r.text.slice(0, 200));
  assert.ok(r.has('Weigh in'), 'and ask for a weigh-in: ' + r.text.slice(0, 200));
  assert.ok(!r.has('Check in'), 'there is nothing yet to check in against: ' + r.text.slice(0, 200));
});

/* ---- the week before the first read ----
   Every new account, and every account that has just been reset, sits in this state for a week. It
   used to be a two-line placeholder in a card half the height of the real one, so the morning the
   trend arrived the strip doubled in size and grew a portrait - the app appearing to change when
   only the data had. These are the tests that it is the SAME card throughout, and that the
   countdown it draws lands on exactly the day the verdict does. */

// The same account as `cutting`, with only the last `days` of weigh-ins kept: somebody part-way
// through their first week (or their first week after a reset).
function startingOut(days) {
  const db = cutting();
  db.weight_entries = db.weight_entries.filter(e => e.date > iso(days));
  db.log_entries = db.log_entries.filter(e => e.date > iso(days));
  return db;
}

test('starting out is the same card, counting the week the trend needs', () => {
  const db = startingOut(3); // readings on the last three days: a two-day span
  assert.equal(A.progressVerdict(db), null, 'the fixture must be short of a read for this to test anything');
  const r = strip(db);
  assert.ok(r.has('This cycle'), 'same card, same name: ' + r.text.slice(0, 200));
  assert.ok(r.has('To your first read'), 'the progress row is still there, counting something else: ' + r.text.slice(0, 260));
  assert.ok(r.has('2 of 7 days'), 'and counting it honestly: ' + r.text.slice(0, 260));
  assert.ok(r.has('5 days to go'), 'the title bar says how long: ' + r.text.slice(0, 260));
  assert.ok(/kg/.test(r.text), 'the last reading is still shown: ' + r.text.slice(0, 260));
});

test('the countdown runs out on the day the verdict arrives', () => {
  // The seam this pair exists for: the strip promising a read on a day the arithmetic would refuse
  // one is the bug, and it can only be caught by walking the two together.
  for (let days = 2; days <= 9; days++) {
    const db = startingOut(days);
    const fr = A.firstReadProgress(db);
    const hasVerdict = !!A.progressVerdict(db);
    assert.equal(hasVerdict, fr.daysLeft === 0,
      'day ' + days + ': the countdown says ' + fr.daysLeft + ' left while the verdict is ' + (hasVerdict ? 'in' : 'out'));
  }
});

test('a day already weighed is not asked to weigh again', () => {
  const withToday = strip(startingOut(3));
  assert.ok(!withToday.has('Weigh in to move this on'), 'today is already on the scales: ' + withToday.text.slice(0, 260));
  const db = startingOut(3);
  db.weight_entries = db.weight_entries.filter(e => e.date !== Store.todayISO());
  assert.ok(strip(db).has('Weigh in to move this on'), 'a day not weighed still gets the ask');
});

test('the first read is dated from the first reading, not from today', () => {
  const db = startingOut(3);
  const fr = A.firstReadProgress(db);
  assert.equal(fr.from, iso(2), 'the span starts at the oldest reading on file');
  assert.equal(fr.expected, A.shiftISO(iso(2), 7), 'and the read is due a week after it');
});

test('the spark needs two readings before it draws anything', () => {
  const one = Object.assign(cutting(), { weight_entries: [{ id: 'w', date: iso(0), scale_weight: 85.4, trend_weight: 85.4 }] });
  assert.equal(render(A.CycleSpark, { db: one }).html, '', 'one point is not a trend');
  assert.ok(render(A.CycleSpark, { db: cutting() }).html.indexOf('polyline') !== -1, 'a real history should draw a line');
});

// ---- and the way back ---------------------------------------------------------------------------

test('Progress names the screen it will go back to', () => {
  // It has no tab of its own and draws its own way back. While You was the only route in, a
  // hard-coded "You" was right; with the strip on Today it would send somebody to a screen they
  // had not been on.
  const db = cutting();
  const props = { db, update() {}, showToast() {}, onCheckIn() {}, onWeigh() {}, onEditPlan() {}, onBack() {} };
  assert.ok(render(A.Goals, Object.assign({}, props, { backLabel: 'Today' })).has('Today'),
    'arriving from Today, the way back should say Today');
  assert.ok(render(A.Goals, props).has('You'), 'and with nothing said, it still says You');
});

/* ---- the Energy card, before it has a burn to show ----
   Same problem, longer clock: this is where an account sits for a fortnight, and it used to be a
   differently shaped card that was replaced wholesale the morning the estimate landed. It also used
   to report two of the three things it was waiting for, so it could show "enough" twice and still
   refuse to say anything. */

const energy = (db) => render(A.ExpenditureCard, { db, plan: null });

test('the burn refusal names all three things it is waiting for, spread included', () => {
  // Four weigh-ins and five logged days, all crammed into three days: both counts are satisfied and
  // the read is still refused, because a snapshot is not a trend.
  const db = cutting();
  db.weight_entries = db.weight_entries.filter(e => e.date > iso(4));
  db.log_entries = db.log_entries.filter(e => e.date > iso(4));
  const est = E.liveExpenditure({
    weights: db.weight_entries.map(w => ({ date: w.date, kg: w.scale_weight })),
    kcalByDate: db.log_entries.reduce((m, e) => Object.assign(m, { [e.date]: e.computed_macros.kcal }), {}),
    today: Store.todayISO(), windowDays: 14, bmr: 1700,
  });
  assert.equal(est.ok, false, 'four days of everything is not a fortnight');
  assert.equal(est.spanDays, 4, 'the refusal carries the spread, not just the counts');
  assert.equal(est.needSpan, 7);
  const r = energy(db);
  assert.ok(r.has('days apart'), 'and the card names it: ' + r.text.slice(0, 300));
  assert.ok(r.has('4/7'), 'with the same numbers the engine refused on: ' + r.text.slice(0, 300));
  assert.ok(r.has('3 days to go'), 'the title bar counts the largest gap, not the sum: ' + r.text.slice(0, 300));
});

test('the burn card keeps its frame while it waits', () => {
  const db = cutting();
  db.weight_entries = []; db.log_entries = [];
  const r = energy(db);
  assert.ok(r.has('Energy'), 'same card, same name: ' + r.text.slice(0, 200));
  assert.ok(r.has('0/4') && r.has('0/5') && r.has('0/7'), 'all three counters start at nothing: ' + r.text.slice(0, 300));
  assert.ok(r.has('last 14 days'), 'and the window is named, not implied: ' + r.text.slice(0, 300));
});

test('a fortnight of honest logging gets the burn read', () => {
  const r = energy(cutting());
  assert.ok(!r.has('days to go'), 'nothing left to wait for: ' + r.text.slice(0, 200));
  assert.ok(r.has('How your burn was worked out'), 'the estimate is in: ' + r.text.slice(0, 300));
});
