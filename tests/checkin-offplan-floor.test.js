'use strict';
/* A week checked in as off plan is ignored by the next check-in COMPLETELY: not just its food, its
 * weigh-ins too. A baseline taken inside that week puts it straight back into the burn through the
 * scale, which is the thing the off-plan answer exists to stop. Walked through the real sheet. */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount } = require('./helpers/app.js');

const A = app();
const TODAY = '2026-10-09';
const realToday = A.Store.todayISO;
const at = (iso, fn) => { A.Store.todayISO = () => iso; try { return fn(); } finally { A.Store.todayISO = realToday; } };
const shift = (iso, n) => A.shiftISO(iso, n);

// Burns 2800. Three on-plan weeks at 2140, then an off-plan week that really ran 1000 a day over a
// log that says 2140, plus the salt-and-carbs water a week like that leaves on the scale, which
// comes off again this week.
function account(lastWeekOffPlan) {
  const db = A.Store.defaultState();
  db.profile = Object.assign({}, db.profile, { sex: 'male', age: 32, heightCm: 175, weightKg: 88, bodyFatPct: 22, goalType: 'cut',
    rateKgPerWeek: 0.6, weight_unit: 'kg', activityLevel: 'very', checkinDay: 5,
    carryover: { enabled: false, mode: 'dispersed', capKcal: 400 }, cycling: { enabled: false, highDays: [], deltaPct: 0.15 } });
  db.buddy = { name: 'Rex' };
  db.targets = [{ id: 't0', kcal: 2140, protein_g: 170, carbs_g: 200, fat_g: 68, effective_date: shift(TODAY, -40), source: 'adaptive', estimatedTDEE: 2800 }];
  db.expenditure = { kcal: 2800, n: 5, q: 1, updated: shift(TODAY, -14) };
  let fat = 88;
  for (let i = 34; i >= 0; i--) {
    const date = shift(TODAY, -i);
    const offWeek = i >= 7 && i < 14;
    fat += ((offWeek ? 3140 : 2140) - 2800) / 7700;
    const water = offWeek ? 0.25 * (14 - i) / 7 + 0.6 : (i < 7 ? Math.max(0, 0.85 - 0.3 * (7 - i)) : 0);
    db.log_entries.push({ id: 'l' + i, date, meal_id: 'm_3', name: 'Day', computed_macros: { kcal: 2140, protein: 170, carbs: 200, fat: 68 } });
    db.weight_entries.push({ id: 'w' + i, date, scale_weight: +(fat + water).toFixed(2) });
  }
  db.checkins = [28, 21, 14, 7].map(n => ({ date: shift(TODAY, -n), adhered: n === 7 ? !lastWeekOffPlan : true, onTrack: true, days: 7,
    weightKg: 88, weeklyChangeKg: -0.6, deltaKcal: 0, tdee: 2800, underReport: false }));
  db.last_checkin = shift(TODAY, -7);
  A.recomputeTrend(db);
  return db;
}

function checkIn(db) {
  return at(TODAY, () => {
    const ui = mount(A.CheckInModal, { db, update: (fn) => fn(db), onClose() {}, isPremium: true });
    try {
      ui.click(ui.has('Right, let’s see') ? 'Right, let’s see' : 'Carry on anyway');
      ui.click('Continue');
      if (ui.has('How are you holding up?')) ui.click('Skip');
      ui.click('On plan');
      ui.click('See what it means');
      return { text: ui.text, ci: db.checkins[db.checkins.length - 1], expenditure: db.expenditure };
    } finally { ui.unmount(); }
  });
}

test('after an off-plan week the check-in learns nothing from it, holds, and says why', () => {
  const r = checkIn(account(true));
  assert.ok(/Your off-plan week is left out completely, food and weigh-ins/.test(r.text), r.text.slice(0, 1200));
  // Read from this week's own weigh-ins: the water the off-plan week left coming off is not read as
  // fat loss against a bloated baseline, so the burn is not pushed up by it.
  assert.ok(r.expenditure.kcal < 2900, 'burn pushed up by the off-plan week: ' + r.expenditure.kcal);
});

test('the same week, had it been on plan, is compared against it as normal', () => {
  const r = checkIn(account(false));
  assert.ok(!/off-plan week is left out/.test(r.text), r.text.slice(0, 600));
});

// The engine side of the same rule.
const E = A.Engine || require('../app/engine.js');
const prof = { sex: 'male', weightKg: 85, heightCm: 175, age: 32, avgSteps: 12000, gymSessionsPerWeek: 5, goalType: 'cut', rateKgPerWeek: 0.81, weight_unit: 'kg', dietStyle: 'balanced' };
function heldDecision(extra) {
  const weights = [], kcalByDate = {}, targetByDate = {};
  for (let i = 6; i >= 0; i--) { const d = shift(TODAY, -i); weights.push({ date: d, kg: 85 - (6 - i) * 0.1 }); kcalByDate[d] = 1800; targetByDate[d] = 1716; }
  return E.checkInDecision(Object.assign({ profile: prof, currentTargets: { kcal: 1716, protein_g: 170 }, weights, kcalByDate, targetByDate,
    cycleStart: shift(TODAY, -6), today: TODAY, cycleDays: 7, floorISO: shift(TODAY, -6), afterOffPlan: true, weighDays: 7, minDays: 5, periodDays: 7,
    expenditure: { kcal: 2750, n: 8, q: 1, kg: 85.5 }, checkins: [] }, extra || {}));
}
test('held after an off-plan week: the burn is not touched and the targets stay', () => {
  const r = heldDecision({ profile: Object.assign({}, prof, { rateKgPerWeek: 0.6 }) });
  assert.strictEqual(r.changed, false);
  assert.ok(!r.expenditure, 'nothing learned from the held week');
  assert.ok(/Your targets hold/.test(r.reason), r.reason);
});
test('held after an off-plan week, but a phase moved the pace: the pace change still goes through on the learned burn', () => {
  const r = heldDecision({ prevRateKgPerWeek: 0.93 });
  assert.strictEqual(r.changed, true);
  assert.ok(!r.expenditure, 'still nothing learned from the held week');
  // 0.93 -> 0.81 kg a week is ~132 kcal a day more food.
  assert.ok(Math.abs(r.deltaKcal - 132) <= 2, 'delta ' + r.deltaKcal);
  assert.ok(/Your pace has moved, though, from 0\.93 kg to 0\.81 kg a week/.test(r.reason), r.reason);
});
test('weight-only lane follows the same rule after an off-plan week', () => {
  const r = heldDecision({ mode: 'weightOnly', prevRateKgPerWeek: 0.93 });
  assert.ok(r.afterOffPlan && r.changed && !r.expenditure, JSON.stringify({ a: r.afterOffPlan, c: r.changed }));
});
