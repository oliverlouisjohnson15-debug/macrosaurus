'use strict';
// The weekly check-in, walked through end to end the way a person does it.
//
// The engine has its own suite, and the cadence has two. What none of them did was sit somebody
// down in front of the real check-in sheet with a realistic month of data behind them and tap
// through it: answer the honesty question, read the result, take or refuse the change, and then
// look at what was saved and when the next one is. The questions this file answers are the ones a
// person asks: if I stuck to it and I'm losing at my rate, does it leave me alone? If I stuck to it
// and I'm not, does it trim me, by a sane amount? If I tell it the week was a write-off, does it
// refuse to steer off it? If I barely logged, does it hold rather than guess? If I check in early,
// do I keep my day?
//
// Every scenario mounts CheckInModal (or Progress) from the real sources and clicks real buttons.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount } = require('./helpers/app.js');

const A = app();

// Friday 9 October 2026. Friday is the check-in day; the last one was a week ago.
const TODAY = '2026-10-09';
const FRIDAY = 5;
const realToday = A.Store.todayISO;
const at = (iso, fn) => { A.Store.todayISO = () => iso; try { return fn(); } finally { A.Store.todayISO = realToday; } };
const shift = (iso, n) => A.shiftISO(iso, n);

const TARGET = { kcal: 2249, protein_g: 170, carbs_g: 221, fat_g: 70 };
const BURN = 3074;   // what the app had learned this person burns

/* A month of somebody's life. `rate` is the true weekly change in kg (negative is loss), applied
 * evenly, with a small fixed wobble so it looks like a real scale rather than a ruler. `eaten` is
 * what they logged each day, `logDays` how many of the last seven they logged at all, `weighDays`
 * how many mornings of the last seven they weighed. The earlier weeks are always complete, so the
 * baseline the check-in reads against is a good one and the scenario is only about THIS week. */
function account({ rate = -0.75, eaten = TARGET.kcal, logDays = 7, weighDays = 7, weights = null, today = TODAY, lastCheckin = null } = {}) {
  const db = A.Store.defaultState();
  db.profile = {
    sex: 'male', age: 31, heightCm: 180, weightKg: 88, bodyFatPct: 22, weight_unit: 'kg',
    activityLevel: 'moderate', goalType: 'cut', rateKgPerWeek: 0.75, dietStyle: 'balanced',
    proteinManualG: 170, checkinDay: FRIDAY,
    carryover: { enabled: false, mode: 'dispersed', capKcal: 400 },
    cycling: { enabled: false, highDays: [], deltaPct: 0.15 },
  };
  db.buddy = { name: 'Rex' };
  db.targets = [Object.assign({ id: 't1', effective_date: shift(today, -40), source: 'adaptive', estimatedTDEE: BURN }, TARGET)];
  db.expenditure = { kcal: BURN, n: 4, updated: shift(today, -7) };
  const last = lastCheckin || shift(today, -7);
  db.last_checkin = last;
  db.checkins = [28, 21, 14].map(n => ({ date: shift(last, -n + 7), weightKg: 88, onTrack: true, adhered: true, days: 7, weeklyChangeKg: -0.75, deltaKcal: 0, tdee: BURN, underReport: false }));
  db.checkins.push({ date: last, weightKg: 88, onTrack: true, adhered: true, days: 7, weeklyChangeKg: -0.75, deltaKcal: 0, tdee: BURN, underReport: false });
  const wobble = [0.15, -0.1, 0.05, -0.2, 0.1, 0, -0.05];
  for (let i = 27; i >= 1; i--) {
    const date = shift(today, -i);
    const inThisCycle = date > last;
    const k = daysIntoCycle(last, date);
    // Weigh-ins: every morning before this cycle, then the first `weighDays` of it (today's reading
    // is typed into the sheet, the way it is on a real morning).
    if (weights) {
      if (weights[date] != null) db.weight_entries.push({ id: 'w' + i, date, scale_weight: weights[date] });
    } else if (!inThisCycle || k <= weighDays - 1) {
      db.weight_entries.push({ id: 'w' + i, date, scale_weight: +(90 + (rate / 7) * (28 - i) + wobble[i % 7]).toFixed(2) });
    }
    if (!inThisCycle || k <= logDays) {
      db.log_entries.push({ id: 'l' + i, date, meal_id: 'm_3', name: 'Day', computed_macros: { kcal: eaten, protein: 170, carbs: 220, fat: 70 } });
    }
  }
  // Today has been logged too: a check-in is done in the evening as often as the morning.
  if (logDays >= 7) db.log_entries.push({ id: 'l0', date: today, meal_id: 'm_3', name: 'Day', computed_macros: { kcal: eaten, protein: 170, carbs: 220, fat: 70 } });
  A.recomputeTrend(db);
  return db;
}
function daysIntoCycle(last, date) { return Math.round((new Date(date) - new Date(last)) / 86400000); }
// Where the trend line would sit this morning, for the weight typed into the sheet.
function morning(db, rate) {
  const lastW = db.weight_entries[db.weight_entries.length - 1];
  const gap = daysIntoCycle(lastW.date, TODAY);
  return +(lastW.scale_weight + (rate / 7) * gap).toFixed(1);
}

/* Through the sheet, the way somebody actually goes: hello, the morning's weight, the honesty
 * question, the read. Returns the mounted sheet sitting on the result, plus the db it wrote to. */
function checkIn(db, { kg, stuckToIt = true, today = TODAY } = {}) {
  return at(today, () => {
    const update = (fn) => fn(db);
    const ui = mount(A.CheckInModal, { db, update, onClose() {}, isPremium: true });
    ui.click(ui.has('Right, let’s see') ? 'Right, let’s see' : 'Carry on anyway');
    if (kg != null) ui.type(ui.host.ownerDocument.querySelector('input[inputmode], input[type="number"], input'), kg);
    ui.click('Continue');
    ui.click(stuckToIt ? 'Yes, pretty much' : 'Not really');
    ui.click('See what it means');
    return ui;
  });
}
const lastCheckin = (db) => db.checkins[db.checkins.length - 1];
const kcalNow = (db) => db.targets[db.targets.length - 1].kcal;

// ---- sticking to it ------------------------------------------------------------------------------

test('stuck to it and losing at the planned rate: it leaves the plan alone', () => {
  const db = account({ rate: -0.75 });
  const ui = checkIn(db, { kg: morning(db, -0.75) });
  try {
    assert.ok(ui.has('Staying on'), 'an on-target week should not propose anything: ' + ui.text.slice(0, 400));
    assert.ok(ui.has(TARGET.kcal + ' kcal'), 'and should say which number it is staying on');
    assert.ok(ui.has('You were aiming for −0.75 kg/wk'), 'the goal rate should read as set, not rounded: ' + ui.text.slice(0, 200));
    assert.ok(!ui.has('What that means for my macros'), 'no decision to make, so no verdict step');
  } finally { ui.unmount(); }
  assert.strictEqual(kcalNow(db), TARGET.kcal, 'the target moved on a week that was exactly on plan');
  const ci = lastCheckin(db);
  assert.strictEqual(ci.date, TODAY);
  assert.ok(Math.abs(ci.weeklyChangeKg + 0.75) < 0.2, 'the rate it read was ' + ci.weeklyChangeKg);
  assert.strictEqual(db.last_checkin, TODAY);
});

test('stuck to it but losing slowly: it trims calories, by a measured step, and only on a yes', () => {
  const db = account({ rate: -0.25 });
  const ui = checkIn(db, { kg: morning(db, -0.25) });
  try {
    assert.ok(ui.has('What that means for my macros'), 'a slow week should lead to a proposal: ' + ui.text.slice(0, 400));
    ui.click('What that means for my macros');
    assert.ok(ui.has('trimming you back'), 'it should say which way it is going: ' + ui.text.slice(0, 300));
    // Nothing is saved until it is accepted.
    assert.strictEqual(kcalNow(db), TARGET.kcal, 'the proposal was written before it was accepted');
    assert.ok(db.pending_adjustment, 'an undecided proposal survives a reload until it is answered');
    at(TODAY, () => ui.click('Do it'));
  } finally { ui.unmount(); }
  // A STEP towards the right number, not the whole way: half a kilo a week short is about 550 kcal
  // a day, and the engine caps one check-in at a tenth of your burn (never over 350).
  const cut = TARGET.kcal - kcalNow(db);
  assert.ok(cut > 0, 'it was meant to trim, it moved ' + -cut);
  assert.ok(cut <= Math.min(350, Math.round(BURN * 0.1)), 'a single check-in cut ' + cut + ' kcal, more than a measured step');
  assert.strictEqual(db.pending_adjustment, null);
  assert.strictEqual(lastCheckin(db).changed, true);
});

test('stuck to it but losing slowly, and keeping the current numbers: nothing changes', () => {
  const db = account({ rate: -0.25 });
  const ui = checkIn(db, { kg: morning(db, -0.25) });
  try {
    ui.click('What that means for my macros');
    at(TODAY, () => ui.click('Keep current'));
  } finally { ui.unmount(); }
  assert.strictEqual(kcalNow(db), TARGET.kcal);
  assert.strictEqual(db.pending_adjustment, null, 'a refused proposal must not come back on reload');
  assert.strictEqual(db.last_checkin, TODAY, 'refusing the change still counts as checking in');
});

test('stuck to it and losing too fast: it gives calories back', () => {
  const db = account({ rate: -1.5 });
  const ui = checkIn(db, { kg: morning(db, -1.5) });
  try {
    assert.ok(ui.has('What that means for my macros'), ui.text.slice(0, 400));
    ui.click('What that means for my macros');
    assert.ok(ui.has('giving you a bit more'), ui.text.slice(0, 300));
    at(TODAY, () => ui.click('Do it'));
  } finally { ui.unmount(); }
  // The burn reads HIGHER on a fast week, so the cap (a tenth of it) is a little higher too.
  const more = kcalNow(db) - TARGET.kcal;
  assert.ok(more > 0 && more <= 350, 'gave back ' + more + ' kcal');
});

// ---- not sticking to it --------------------------------------------------------------------------

test('a week that was not stuck to: it holds and says why, whatever the scale did', () => {
  // A slow week that WOULD have been trimmed had they said yes. Saying no must not steer off it.
  const db = account({ rate: -0.25 });
  const ui = checkIn(db, { kg: morning(db, -0.25), stuckToIt: false });
  try {
    assert.ok(ui.has('Macros held'), 'an off-plan week should be held: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Staying on'));
    assert.ok(!ui.has('What that means for my macros'), 'no proposal off a week you said was off plan');
  } finally { ui.unmount(); }
  assert.strictEqual(kcalNow(db), TARGET.kcal);
  assert.strictEqual(db.pending_adjustment, null);
  const ci = lastCheckin(db);
  assert.strictEqual(ci.adhered, false, 'the answer is recorded, so the history is honest');
  // ...but the weigh-in itself is kept, so next week's read has it.
  assert.ok(db.weight_entries.some(w => w.date === TODAY), 'the morning weight was thrown away');
});

test('barely logged this week: it goes on the scale alone, and says so before acting on it', () => {
  // Two days of food is not an intake. The app steers by the weigh-ins instead and assumes you ate
  // roughly to plan, which is a fair default and a big assumption, so it is said on the first screen.
  const db = account({ rate: -0.25, logDays: 2 });
  const ui = at(TODAY, () => mount(A.CheckInModal, { db, update: (fn) => fn(db), onClose() {}, isPremium: true }));
  try {
    assert.ok(ui.has('you logged 2 days'), ui.text.slice(0, 300));
    assert.ok(ui.has('I will go on your weigh-ins and take it you ate roughly to plan'), 'the switch to the scale alone was silent: ' + ui.text.slice(0, 500));
  } finally { ui.unmount(); }
  // Said yes: the scale alone says slow, so it trims.
  const ui2 = checkIn(db, { kg: morning(db, -0.25) });
  try { assert.ok(ui2.has('What that means for my macros'), ui2.text.slice(0, 400)); } finally { ui2.unmount(); }
  // Said no: the assumption is gone, so it holds.
  const db2 = account({ rate: -0.25, logDays: 2 });
  const ui3 = checkIn(db2, { kg: morning(db2, -0.25), stuckToIt: false });
  try { assert.ok(ui3.has('Macros held'), ui3.text.slice(0, 400)); } finally { ui3.unmount(); }
  assert.strictEqual(kcalNow(db2), TARGET.kcal);
});

test('barely logged AND barely weighed: it holds rather than guess', () => {
  const db = account({ rate: -0.25, logDays: 2, weighDays: 1 });
  const ui = at(TODAY, () => mount(A.CheckInModal, { db, update: (fn) => fn(db), onClose() {}, isPremium: true }));
  try { assert.ok(ui.has('Carry on anyway'), ui.text.slice(0, 300)); } finally { ui.unmount(); }
  const ui2 = checkIn(db, { kg: morning(db, -0.25) });
  try { assert.ok(!ui2.has('What that means for my macros'), ui2.text.slice(0, 400)); } finally { ui2.unmount(); }
  assert.strictEqual(kcalNow(db), TARGET.kcal);
});

test('barely weighed this week: it holds too, the food log alone is not a trend', () => {
  const db = account({ rate: -0.25, weighDays: 1 });
  const ui = checkIn(db, { kg: morning(db, -0.25) });
  try {
    assert.ok(!ui.has('What that means for my macros'), 'it proposed a change off two weigh-ins: ' + ui.text.slice(0, 400));
  } finally { ui.unmount(); }
  assert.strictEqual(kcalNow(db), TARGET.kcal);
});

// ---- the week that moved late ----------------------------------------------------------------------

test('a week that dropped late: the read says the rest is not lost', () => {
  // The shape of a real week: flat around 87.7 for a fortnight, then four mornings falling to 86.9.
  // Average to average that is a slow week, and the screen used to leave it there.
  const weights = {};
  const flat = [87.9, 87.5, 87.25, 88.0, 87.7, 87.15, 87.8, 88.1, 87.8, 87.9, 87.6, 87.75, 87.9, 88.0];
  for (let i = 0; i < flat.length; i++) weights[shift(TODAY, -21 + i)] = flat[i];
  Object.assign(weights, { [shift(TODAY, -7)]: 87.8, [shift(TODAY, -6)]: 87.9, [shift(TODAY, -5)]: 87.7,
    [shift(TODAY, -4)]: 87.3, [shift(TODAY, -3)]: 86.9, [shift(TODAY, -2)]: 86.75, [shift(TODAY, -1)]: 86.8 });
  const db = account({ weights });
  const ui = checkIn(db, { kg: 86.7 });
  try {
    assert.ok(ui.has('below this cycle’s average'), 'a late drop should be explained: ' + ui.text.slice(0, 500));
    assert.ok(ui.has('it shows up in your next check-in'));
    ui.click('The numbers behind it');
    assert.ok(ui.has('Average trend weight, last cycle to this one'), 'the averages should be labelled as averages');
    assert.ok(ui.has('Your trend today'));
  } finally { ui.unmount(); }
});

test('an ordinary steady week does not get the late-move note', () => {
  const db = account({ rate: -0.75 });
  const ui = checkIn(db, { kg: morning(db, -0.75) });
  try {
    assert.ok(!ui.has('this cycle’s average'), 'a steady week was told it moved late: ' + ui.text.slice(0, 500));
  } finally { ui.unmount(); }
});

// ---- checking in early ----------------------------------------------------------------------------

function progress(db, today) {
  return at(today, () => mount(A.Goals, { db, update: (fn) => fn(db), showToast() {}, onCheckIn() {}, onWeigh() {}, onEditPlan() {}, onBack() {} }));
}

test('checking in two days early keeps your day, and the dialog says when the next one is', () => {
  // Friday is the day; it is Wednesday, five days after the last one.
  const wed = shift(TODAY, -2);
  const db = account({ rate: -0.75, today: wed, lastCheckin: shift(wed, -5) });
  const ui = progress(db, wed);
  try {
    assert.ok(ui.has('Next check-in'), ui.text.slice(0, 300));
    // Clicked on the same (pinned) day the screen was drawn on: the dialog re-reads today.
    at(wed, () => ui.click('Check in early'));
    assert.ok(ui.has('Check in early?'));
    assert.ok(ui.has('It has been 5 days'), ui.text.slice(-500));
    assert.ok(ui.has('Your check-in day stays Friday'), 'the dialog should promise the day, not a reset: ' + ui.text.slice(-500));
    // ...and name the Friday after next, nine days on: not the one in two days, which would be a
    // two-day cycle, and not the Wednesday a week on, which is the drift this replaced.
    assert.ok(ui.has('Friday ' + A.fmtShortDay(shift(wed, 9))), ui.text.slice(-400));
  } finally { ui.unmount(); }
  // Take it, then walk the calendar forward and see where the next one lands.
  const ui2 = checkIn(db, { kg: morning(db, -0.75), today: wed });
  ui2.unmount();
  assert.strictEqual(db.last_checkin, wed);
  const next = at(wed, () => A.checkinStatus(db, wed));
  assert.strictEqual(next.nextISO, shift(wed, 9));
  assert.strictEqual(new Date(next.nextISO + 'T00:00:00').getDay(), FRIDAY);
  // And the one after that is an ordinary week.
  db.last_checkin = next.nextISO; db.checkins.push({ date: next.nextISO });
  assert.strictEqual(at(next.nextISO, () => A.checkinStatus(db, next.nextISO)).nextISO, shift(next.nextISO, 7));
});

test('the day of a check-in, and the day after, offer no second one', () => {
  for (const gap of [0, 1]) {
    const day = shift(TODAY, gap);
    const db = account({ rate: -0.75, lastCheckin: TODAY, today: day });
    const ui = progress(db, day);
    try {
      assert.ok(!ui.has('Check in early'), 'a second check-in was offered ' + gap + ' day(s) after the last');
      assert.ok(ui.has(gap === 0 ? 'You checked in today' : 'You checked in yesterday'), ui.text.slice(0, 400));
    } finally { ui.unmount(); }
  }
});

test('checking in twice on the same day keeps one record of it', () => {
  const db = account({ rate: -0.75 });
  checkIn(db, { kg: morning(db, -0.75) }).unmount();
  checkIn(db, { kg: morning(db, -0.75) }).unmount();
  assert.strictEqual(db.checkins.filter(c => c.date === TODAY).length, 1);
  assert.strictEqual(db.badges.checkins, 1, 'the badge track counted the same day twice');
});

test('on your day it is simply due, with no early door', () => {
  const db = account({ rate: -0.75 });
  const ui = progress(db, TODAY);
  try {
    assert.ok(ui.has('Due now'), ui.text.slice(0, 300));
    assert.ok(!ui.has('Check in early'));
  } finally { ui.unmount(); }
});


// ---- several weeks in a row ----------------------------------------------------------------------

/* The point of the whole product, run forward. Somebody whose real burn is lower than the app thinks
 * (2,800, not 3,074) eats exactly what they are told every day and accepts every change. Their body
 * follows the energy balance, with a daily wobble on the scale. Week after week, the targets should
 * walk down towards the number that actually loses 0.75 kg a week, in measured steps, and settle
 * there rather than overshoot and swing. Every check-in is done through the sheet. */
test('eight honest weeks with a wrong starting burn: the targets find the right number and settle', () => {
  const TRUE_BURN = 2800;
  const RIGHT = TRUE_BURN - Math.round(0.75 * 7700 / 7);   // what actually loses 0.75 kg a week
  // Start from a steady fortnight at the old target, so week one has a clean baseline.
  let day = shift(TODAY, -14);
  const db = account({ rate: -0.25, today: day, lastCheckin: shift(day, -7) });
  db.weight_entries = db.weight_entries.filter(w => w.date < day);
  db.log_entries = db.log_entries.filter(e => e.date < day);
  let w = db.weight_entries[db.weight_entries.length - 1].scale_weight;
  const wobble = [0.2, -0.15, 0.05, -0.25, 0.1, 0.15, -0.1];
  const steps = [], rates = [];
  let n = 0;
  for (let week = 0; week < 8; week++) {
    for (let d = 0; d < 7; d++, n++) {
      const kcal = kcalNow(db);
      db.log_entries.push({ id: 's' + n, date: day, meal_id: 'm_3', name: 'Day', computed_macros: { kcal, protein: 170, carbs: 200, fat: 65 } });
      w += (kcal - TRUE_BURN) / 7700;
      if (d < 6) db.weight_entries.push({ id: 'sw' + n, date: day, scale_weight: +(w + wobble[n % 7]).toFixed(2) });
      if (d < 6) day = shift(day, 1);
    }
    A.recomputeTrend(db);
    const before = kcalNow(db);
    const ui = checkIn(db, { kg: +(w + wobble[n % 7]).toFixed(1), today: day });
    try {
      if (ui.has('What that means for my macros')) { ui.click('What that means for my macros'); at(day, () => ui.click('Do it')); }
    } finally { ui.unmount(); }
    steps.push(kcalNow(db) - before);
    rates.push(lastCheckin(db).weeklyChangeKg);
    day = shift(day, 1);
  }
  const final = kcalNow(db);
  assert.ok(steps.every(s => Math.abs(s) <= 350), 'a step was bigger than the cap: ' + steps.join(', '));
  assert.ok(Math.abs(final - RIGHT) <= 150, 'ended on ' + final + ' kcal, the right number is ' + RIGHT + ' (steps ' + steps.join(', ') + ')');
  // Settled: no more than one change of direction across the run (one correction, not a swing).
  const dirs = steps.filter(s => s !== 0).map(Math.sign);
  const flips = dirs.slice(1).filter((s, i) => s !== dirs[i]).length;
  assert.ok(flips <= 1, 'the target swung back and forth: ' + steps.join(', '));
  // ...and the last fortnight is losing close to the goal rate.
  const tail = rates.slice(-2).reduce((a, b) => a + b, 0) / 2;
  assert.ok(Math.abs(tail + 0.75) <= 0.2, 'the last two weeks read ' + rates.slice(-2).join(', ') + ' kg/wk');
});

test('a full week waiting on your day is not called a short cycle', () => {
  // Monday is the day, it is Saturday, and the last check-in was last Saturday: seven days, a whole
  // week, held back only so the next one lands on Monday. Checking in now loses nothing.
  const sat = '2026-10-10';
  const db = account({ rate: -0.75, today: sat, lastCheckin: shift(sat, -7) });
  db.profile.checkinDay = 1;
  const ui = progress(db, sat);
  try {
    at(sat, () => ui.click('Check in early'));
    assert.ok(ui.has('there is a full week to read'), ui.text.slice(-500));
    assert.ok(!ui.has('shorter than the week'), 'a seven-day cycle was called short');
    assert.ok(ui.has('Your check-in day stays Monday'));
  } finally { ui.unmount(); }
});
