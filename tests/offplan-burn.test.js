'use strict';
/* "I didn't stick to the plan" means the log can't be trusted even where it looks complete: food that
 * was eaten and never made it in. So a week answered that way is disregarded by everything that reads
 * a burn, including the live Energy estimate on Progress, not just the check-in. */
const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('./helpers/app.js');

const A = app();
const S = A.Store;

// Three weeks at a true burn of 2800. The middle week looks fully logged at target, but the person
// said they went off plan: really they ate 800 more a day that never reached the log.
function account(offPlanAnswered) {
  const today = S.todayISO();
  const db = S.defaultState();
  db.profile = Object.assign({}, db.profile, { sex: 'male', age: 32, heightCm: 175, weightKg: 88, goalType: 'cut', rateKgPerWeek: 0.6, weight_unit: 'kg' });
  db.targets = [{ id: 't0', kcal: 2140, protein_g: 170, carbs_g: 200, fat_g: 68, effective_date: A.shiftISO(today, -30) }];
  let kg = 88;
  for (let i = 20; i >= 0; i--) {
    const date = A.shiftISO(today, -i);
    const offWeek = i >= 7 && i < 14;
    const eaten = offWeek ? 2940 : 2140;
    kg += (eaten - 2800) / 7700;
    db.log_entries.push({ id: 'l' + i, date, meal_id: 'm_3', name: 'Day', computed_macros: { kcal: 2140, protein: 170, carbs: 200, fat: 68 } });
    db.weight_entries.push({ id: 'w' + i, date, scale_weight: +kg.toFixed(2) });
  }
  db.checkins = [
    { date: A.shiftISO(today, -14), adhered: true },
    { date: A.shiftISO(today, -7), adhered: !offPlanAnswered },
  ];
  db.last_checkin = A.shiftISO(today, -7);
  A.recomputeTrend(db);
  return db;
}

test('Energy burn: a week you said was off plan is left out, so its hidden eating cannot drag the burn down', () => {
  const trusted = A.burnEstimate(account(false));
  const disregarded = A.burnEstimate(account(true));
  assert.ok(trusted && trusted.tdee, 'reads a burn when the week is taken at face value');
  // Taken at face value, the off-plan week's weight gain on a "2140" log reads as a far lower burn.
  assert.ok(trusted.tdee < 2650, 'face value reads low: ' + trusted.tdee);
  // Disregarded, only the clean week after it is read, which sits near the true 2800.
  assert.ok(disregarded && disregarded.tdee, 'still reads a burn from the clean days');
  assert.ok(Math.abs(disregarded.tdee - 2800) < 100, 'disregarded reads ' + disregarded.tdee);
});
