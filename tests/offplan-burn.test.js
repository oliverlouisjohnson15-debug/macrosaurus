'use strict';
/* "I didn't stick to the plan" means the log can't be trusted even where it looks complete: food that
 * was eaten and never made it in. So a week answered that way is disregarded by everything that reads
 * a burn, including the live Energy estimate on Progress, not just the check-in. */
const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('./helpers/app.js');

const A = app();
const S = A.Store;
A.MISPREMIUM = true; // the balance block is Premium

// Three weeks at a true burn of 2800. One week looks fully logged at target, but the person
// said they went off plan: really they ate 800 more a day that never reached the log.
function account(offPlanAnswered, endedDaysAgo = 10) {
  const today = S.todayISO();
  const db = S.defaultState();
  db.profile = Object.assign({}, db.profile, { sex: 'male', age: 32, heightCm: 175, weightKg: 88, goalType: 'cut', rateKgPerWeek: 0.6, weight_unit: 'kg' });
  db.targets = [{ id: 't0', kcal: 2140, protein_g: 170, carbs_g: 200, fat_g: 68, effective_date: A.shiftISO(today, -30) }];
  let kg = 88;
  for (let i = 20; i >= 0; i--) {
    const date = A.shiftISO(today, -i);
    // Ten days ago by default: the burn's weigh-ins wait out three days of the week's water after it.
    const offWeek = i >= endedDaysAgo && i < endedDaysAgo + 7;
    const eaten = offWeek ? 2940 : 2140;
    kg += (eaten - 2800) / 7700;
    db.log_entries.push({ id: 'l' + i, date, meal_id: 'm_3', name: 'Day', computed_macros: { kcal: 2140, protein: 170, carbs: 200, fat: 68 } });
    db.weight_entries.push({ id: 'w' + i, date, scale_weight: +kg.toFixed(2) });
  }
  db.checkins = [
    { date: A.shiftISO(today, -(endedDaysAgo + 7)), adhered: true },
    { date: A.shiftISO(today, -endedDaysAgo), adhered: !offPlanAnswered },
  ];
  db.last_checkin = A.shiftISO(today, -endedDaysAgo);
  A.recomputeTrend(db);
  return db;
}

test('Energy burn: a week you said was off plan is left out, so its hidden eating cannot drag the burn down', () => {
  // Taken at face value with the whole week inside the fortnight the burn reads.
  const trusted = A.burnEstimate(account(false, 7));
  const disregarded = A.burnEstimate(account(true));
  assert.ok(trusted && trusted.tdee, 'reads a burn when the week is taken at face value');
  // Taken at face value, the off-plan week's weight gain on a "2140" log reads as a far lower burn.
  assert.ok(trusted.tdee < 2650, 'face value reads low: ' + trusted.tdee);
  // Disregarded, only the on-plan week after it is read, which sits near the true 2800.
  assert.ok(disregarded && disregarded.tdee, 'still reads a burn from the on-plan days');
  assert.ok(Math.abs(disregarded.tdee - 2800) < 100, 'disregarded reads ' + disregarded.tdee);
});

test('Energy card says the off-plan week was left out, and counts only the days the burn rests on', () => {
  const { mount } = require('./helpers/app.js');
  const db = account(true);
  const ui = mount(A.ExpenditureCard, { db, plan: null });
  try {
    ui.click('How your burn was worked out');
    assert.ok(ui.has('(your off-plan week is left out)'), ui.text.slice(0, 900));
    assert.ok(/7 off-plan days are greyed out and left out of this/.test(ui.text), ui.text.slice(0, 900));
    assert.ok(!/of 14 days fully logged/.test(ui.text), 'still resting on the off-plan fortnight: ' + ui.text.slice(-200));
  } finally { ui.unmount(); }
});

test('the burn waits out an off-plan week\'s water: its first three mornings after are not read as fat loss', () => {
  // A week after the off-plan week ended, only four clean weigh-ins have passed the washout.
  const est = A.burnEstimate(account(true, 7));
  assert.ok(!est || !(est.tdee > 0) || est.ok === false, 'read a burn from the washout mornings: ' + JSON.stringify(est && { tdee: est.tdee, ok: est.ok }));
  const { mount } = require('./helpers/app.js');
  const ui = mount(A.ExpenditureCard, { db: account(true, 7), plan: null });
  try { assert.ok(/after your off-plan week/.test(ui.text) && /first read from/.test(ui.text), ui.text.slice(0, 500)); }
  finally { ui.unmount(); }
});
