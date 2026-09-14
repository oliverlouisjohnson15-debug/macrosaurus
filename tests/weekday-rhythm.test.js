'use strict';
/* "Why is Sunday always heavier?"
 *
 * Somebody whose Friday and Saturday are the big days carries the extra glycogen - and the ~3 g of
 * water that comes with each gram of it - into the mornings after. The engine has never acted on
 * that: the trend line absorbs it, and since cycleMeans started reading whole weeks the rhythm
 * cancels out of the check-in rather than tilting the rate. What was missing was SAYING so. Left
 * unsaid, the reading somebody reaches for is "the plan stopped working", and that is the one that
 * talks them into cutting harder on water.
 *
 * So: the engine decides when there is something to say, and the chart says it. Both halves are
 * tested here, because a note that fires on the wrong mornings is worse than no note - it becomes
 * furniture, and furniture is not read.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');
const { app, render } = require('./helpers/app.js');

const A = app();
const Store = A.Store;
const dow = iso => new Date(iso + 'T00:00:00Z').getUTCDay();

// A week of mornings ending on `last`, each one on its trend, so the only thing any test below is
// asserting on is the reading it deliberately lifts off it.
function mornings(last, n = 7) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = A.shiftISO(last, -i);
    out.push({ date, scaleKg: 90, trendKg: 90 });
  }
  return out;
}

// ---- the engine: which mornings are worth explaining ----

test('weekdayRhythm: the morning after a big day, when the scale is actually up on it', () => {
  const ents = mornings('2026-09-13');            // Sunday
  ents[ents.length - 1].scaleKg = 90.6;           // the Sunday reading, 0.6 over its trend
  const r = E.weekdayRhythm({ entries: ents, highDates: ['2026-09-12'], today: '2026-09-13' });
  assert.strictEqual(r.on, true);
  assert.strictEqual(r.date, '2026-09-13');
  assert.strictEqual(r.highDate, '2026-09-12');
  assert.strictEqual(r.weekday, 6, 'the big day was a Saturday and the note should name it');
  assert.strictEqual(r.daysAfter, 1);
  assert.strictEqual(r.aboveKg, 0.6);
});

test('weekdayRhythm: silent on a morning the scale behaved', () => {
  // The whole point is that it explains a reading somebody is looking at and wondering about. A
  // note that appears every weekend whatever the scale did is decoration.
  const on = mornings('2026-09-13');
  assert.strictEqual(E.weekdayRhythm({ entries: on, highDates: ['2026-09-12'], today: '2026-09-13' }).on, false);
  const under = mornings('2026-09-13');
  under[under.length - 1].scaleKg = 89.4;         // DOWN on the trend, after the big day
  assert.strictEqual(E.weekdayRhythm({ entries: under, highDates: ['2026-09-12'], today: '2026-09-13' }).on, false);
  const barely = mornings('2026-09-13');
  barely[barely.length - 1].scaleKg = 90.1;       // up, but by less than a scale's own noise
  assert.strictEqual(E.weekdayRhythm({ entries: barely, highDates: ['2026-09-12'], today: '2026-09-13' }).on, false);
});

test('weekdayRhythm: two mornings is the reach, because that is how long the water lasts', () => {
  const ents = mornings('2026-09-13');
  ents[ents.length - 1].scaleKg = 90.6;
  const two = E.weekdayRhythm({ entries: ents, highDates: ['2026-09-11'], today: '2026-09-13' });
  assert.strictEqual(two.on, true);
  assert.strictEqual(two.daysAfter, 2);
  // Three days out it is no longer an explanation, it is an excuse.
  assert.strictEqual(E.weekdayRhythm({ entries: ents, highDates: ['2026-09-10'], today: '2026-09-13' }).on, false);
});

test('weekdayRhythm: nothing to say without a plan that makes days big', () => {
  const ents = mornings('2026-09-13');
  ents[ents.length - 1].scaleKg = 90.6;
  assert.strictEqual(E.weekdayRhythm({ entries: ents, highDates: [], today: '2026-09-13' }).on, false);
  assert.strictEqual(E.weekdayRhythm({ entries: [], highDates: ['2026-09-12'], today: '2026-09-13' }).on, false);
});

test('weekdayRhythm: a morning with no trend behind it yet is not read', () => {
  // The first weigh-in of an account has nothing to be above.
  const r = E.weekdayRhythm({
    entries: [{ date: '2026-09-13', scaleKg: 90.6, trendKg: null }],
    highDates: ['2026-09-12'], today: '2026-09-13',
  });
  assert.strictEqual(r.on, false);
});

// ---- the chart: the words a person actually meets ----

// An account weighing daily, with the big days where this user's are. Dates run to today because
// that is what the component reads, and the high day is set from yesterday's weekday so the note
// has something to explain whichever day the suite happens to run on.
function rhythmAccount(aboveKg) {
  const today = Store.todayISO();
  const entries = [];
  for (let i = 9; i >= 0; i--) {
    const date = A.shiftISO(today, -i);
    entries.push({ id: 'w' + i, date, scale_weight: 90, trend_weight: 90 });
  }
  entries[entries.length - 1].scale_weight = 90 + aboveKg;
  return {
    weight_entries: entries,
    targets: [{ id: 't1', effective_date: A.shiftISO(today, -30), kcal: 2300, protein_g: 172, fat_g: 73, carbs_g: 230 }],
    checkins: [], week_plans: [], log_entries: [], day_overrides: {},
    profile: {
      sex: 'male', weightKg: 90, heightCm: 175, age: 32, goalType: 'cut', rateKgPerWeek: 0.5,
      weight_unit: 'kg', bodyFatPct: 22, avgSteps: 10000, gymSessionsPerWeek: 4,
      cycling: { enabled: true, deltaPct: 0.2, highDays: [dow(A.shiftISO(today, -1))] },
    },
  };
}

test('the weight chart explains the morning after a big day rather than leaving it hanging', () => {
  const r = render(A.WeekdayRhythmNote, { db: rhythmAccount(0.5) });
  assert.ok(r.has('0.5 kg'), 'it should name how far above the trend the reading sat');
  assert.ok(/above your trend/.test(r.text), 'it should say what the reading is above');
  assert.ok(/the morning after/.test(r.text), 'it should tie the reading to the day that caused it');
  assert.ok(/water/.test(r.text), 'it should say what the scale is actually weighing');
  // And it should say the thing that stops somebody acting on it.
  assert.ok(/trend line and\s+your check-in both read past it|read past it/.test(r.text.replace(/\s+/g, ' ')),
    'it should say the plan is not being tuned on this');
});

test('the chart says nothing on a morning that needs no explaining', () => {
  assert.strictEqual(render(A.WeekdayRhythmNote, { db: rhythmAccount(0) }).html, '');
  assert.strictEqual(render(A.WeekdayRhythmNote, { db: rhythmAccount(-0.4) }).html, '');
});

test('the chart says nothing to somebody whose week has no shape', () => {
  const flat = rhythmAccount(0.5);
  flat.profile.cycling = { enabled: false, deltaPct: 0.2, highDays: [] };
  assert.strictEqual(render(A.WeekdayRhythmNote, { db: flat }).html, '');
});

// recentHighDates is what turns a dated plan into the days the note may point at. It reads the
// shape that was in force ON each day, so retuning your big days this week cannot rewrite which
// days were big last week - the same rule the rest of the app composes a day's target by.
test('recentHighDates: the days the plan made big, judged by the plan that was in force', () => {
  const today = Store.todayISO();
  const db = rhythmAccount(0.5);
  const yesterday = A.shiftISO(today, -1);
  const highs = A.recentHighDates(db, today, 14);
  assert.ok(highs.indexOf(yesterday) !== -1, 'yesterday was the big day and should be listed');
  assert.ok(highs.every(d => dow(d) === dow(yesterday)), 'only that weekday should be listed');
  // A weekday that only became big three days ago was not big the week before, so the note must not
  // point at last Saturday as the reason this Sunday read high. (A shape with no history behind it
  // does apply backwards - cyclingOn falls back to the earliest entry on purpose, to carry the plan
  // that was running before the app started recording changes - so the history has to say so.)
  db.profile.cyclingHistory = [
    { effective_date: A.shiftISO(today, -5), enabled: false, deltaPct: 0.2, highDays: [] },
    { effective_date: A.shiftISO(today, -3), enabled: true, deltaPct: 0.2, highDays: [dow(yesterday)] },
  ];
  // Joined rather than deep-compared: the app runs in its own vm realm, so the array it hands back
  // has a different Array prototype and deepStrictEqual fails on two identical lists.
  assert.strictEqual(Array.from(A.recentHighDates(db, today, 14)).join(), yesterday,
    'only the days the big-day plan actually governed should count');
});
