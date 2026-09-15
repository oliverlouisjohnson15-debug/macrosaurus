'use strict';
/* Moving your check-in day, end to end.
 *
 * The setting existed and could not take effect. Somebody checking in on Tuesdays who moved to
 * Friday was offered Tuesday, the same Tuesday, every week: three days is under the drift floor, so
 * the new day was never reachable, and the only way through was to skip a check-in by hand and hope
 * the app re-anchored. Moving the other way (Tuesday -> Wednesday) was worse, because the full-week
 * clause fired on the Tuesday FIRST and re-anchored to it, so the move could never arrive at all.
 *
 * The reason people move it is the reason the short cycle it makes has to be read carefully. Big
 * days on Friday and Saturday put glycogen - and about 3 g of water per gram of it - on the scale
 * into Sunday and Monday, so a Tuesday reading is the top of that curve and a Friday one is the
 * bottom. Reading the three days BETWEEN them on their own would turn the move itself into a
 * whoosh, and then into a calorie cut off water. So the cycle shortens, the window it is read over
 * does not, and the days already read are discounted rather than counted twice.
 *
 * tests/checkin-cadence.test.js holds the rule in isolation; this holds the journey through the app.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, render } = require('./helpers/app.js');

const A = app();
const Store = A.Store;
const noop = () => {};
const dow = iso => new Date(iso + 'T00:00:00').getDay();

// Somebody a few weeks in, weighing every morning, who checks in on Tuesdays.
function tuesdayAccount(todayISO) {
  const db = Store.defaultState();
  db.profile = { goalType: 'cut', weight_unit: 'kg', rateKgPerWeek: 0.5, checkinDay: 2, weighCadence: 'daily' };
  db.last_checkin = todayISO;
  db.checkins = [{ date: todayISO }];
  for (let i = 27; i >= 0; i--) {
    const d = A.shiftISO(todayISO, -i);
    db.weight_entries.push({ id: 'w' + i, date: d, scale_weight: 90 - (27 - i) * 0.07 });
  }
  return db;
}

// The Tuesday they moved it: 2026-09-15.
const TUE = '2026-09-15';
const FRI = A.shiftISO(TUE, 3);

test('the Tuesday it was moved, the check-in is already looking at Friday', () => {
  assert.strictEqual(dow(TUE), 2);
  assert.strictEqual(dow(FRI), 5);
  const db = tuesdayAccount(TUE);
  db.profile.checkinDay = 5;
  db.profile.checkinDayMovedAt = TUE;
  const st = A.checkinStatus(db, TUE);
  assert.strictEqual(st.due, false, 'not today - you checked in this morning');
  assert.strictEqual(st.nextISO, FRI, 'the next check-in should be the new day, not the old rhythm');
  assert.strictEqual(A.checkinWaitLabel(st), 'In 3 days · Friday');
});

test('without the move the old day just comes round again, which is the bug', () => {
  // The same account with the day changed but nothing recording that it MOVED: the full-week clause
  // wins, Tuesday is offered, and taking it re-anchors to Tuesday for another week.
  const db = tuesdayAccount(TUE);
  db.profile.checkinDay = 5;
  assert.strictEqual(A.checkinStatus(db, TUE).nextISO, A.shiftISO(TUE, 7));
  assert.strictEqual(dow(A.checkinStatus(db, TUE).nextISO), 2);
});

test('the short cycle is read over a whole week, not the three days it contains', () => {
  const db = tuesdayAccount(TUE);
  db.profile.checkinDay = 5;
  db.profile.checkinDayMovedAt = TUE;
  const cov = A.cycleCoverage(db, FRI, { read: true });
  assert.strictEqual(cov.anchor, A.shiftISO(TUE, 1), 'the cycle itself starts the day after the check-in');
  assert.strictEqual(cov.newDays, 3, 'three days of it are new');
  assert.strictEqual(cov.days, 7, 'but it is read over a week');
  assert.strictEqual(cov.cs, A.shiftISO(FRI, -6));
  assert.strictEqual(cov.widened, true);
  // Whole weeks means one Friday and one Saturday in the window, wherever the big days fall.
  const seen = {};
  for (let d = cov.cs; d <= FRI; d = A.shiftISO(d, 1)) seen[dow(d)] = (seen[dow(d)] || 0) + 1;
  assert.deepStrictEqual(Object.values(seen), [1, 1, 1, 1, 1, 1, 1], 'a weekday landed twice, which is the tilt this exists to stop');
});

test('the days already acted on are discounted, not counted twice', () => {
  const db = tuesdayAccount(TUE);
  db.profile.checkinDay = 5;
  db.profile.checkinDayMovedAt = TUE;
  const cov = A.cycleCoverage(db, FRI, { read: true });
  assert.ok(cov.confScale > 0 && cov.confScale < 1, 'a widened window claimed a full cycle of new evidence');
  assert.strictEqual(Math.round(cov.confScale * 7), 3);
});

test('an ordinary week is untouched by any of this', () => {
  const db = tuesdayAccount(TUE);
  const nextTue = A.shiftISO(TUE, 7);
  const cov = A.cycleCoverage(db, nextTue, { read: true });
  assert.strictEqual(cov.widened, false);
  assert.strictEqual(cov.confScale, 1, 'a full cycle is full evidence');
  assert.strictEqual(cov.cs, cov.anchor);
  assert.strictEqual(A.checkinStatus(db, nextTue).due, true);
});

test('every other surface still sees the cycle it is actually in', () => {
  // The check-in reads back a week; a panel counting "this cycle" must not, or the morning you check
  // in reads as a week in which you logged nothing.
  const db = tuesdayAccount(TUE);
  assert.ok(A.cycleCoverage(db, TUE).cs > TUE, 'the day you check in, the next cycle starts tomorrow');
  const cov = A.cycleCoverage(db, FRI);
  assert.strictEqual(cov.cs, A.shiftISO(TUE, 1));
  assert.strictEqual(cov.widened, false);
});

test('the settings screen says what the move will do, rather than leaving you to find out', () => {
  const db = tuesdayAccount(TUE);
  db.profile.checkinDay = 5;
  db.profile.checkinDayMovedAt = TUE;
  const r = render(A.CheckinsScreen, { db, update: noop, onBack: noop });
  assert.ok(r.has('Moved to Fridays'), 'the screen that moved the day says nothing about the move');
  assert.ok(/read over a full week/.test(r.text), 'it should say the short cycle is still read honestly');
});

test('a day that has not moved says nothing about moving', () => {
  const r = render(A.CheckinsScreen, { db: tuesdayAccount(TUE), update: noop, onBack: noop });
  assert.ok(!/Moved to/.test(r.text), 'the transition line is furniture on a settled account');
});
