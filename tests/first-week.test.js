'use strict';
// A new account's first week, as a person meets it (design-plans/30 and 31). Each test is one thing that
// a simulated user ran into between setup and the first check-in.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');
const { app } = require('./helpers/app.js');

const A = app();
const Store = A.Store;
const today = Store.todayISO();

test('a new plan and every day built from it agree on carbs', () => {
  // Setup and Progress said 109 g while Today said 108 g: carbs were derived from the unrounded fat in
  // one place and the rounded fat in the other. Sweep enough weights to cross rounding boundaries.
  const base = { sex: 'female', age: 29, heightCm: 165, avgSteps: 6000, gymSessionsPerWeek: 1, goalType: 'cut', rateKgPerWeek: 0.5, dietStyle: 'balanced' };
  for (let kg = 50; kg <= 110; kg += 0.7) {
    const t = E.computeInitialTargets(Object.assign({}, base, { weightKg: kg }));
    assert.strictEqual(E.applyKcalDelta(t, 0).carbs_g, t.carbs_g, 'carbs disagree at ' + kg.toFixed(1) + ' kg');
  }
});

test('search puts the cooked form of a staple above the raw one', () => {
  const foods = ['Rice, white, basmati, raw', 'Rice, white, pudding, raw', 'Rice, white, basmati, boiled in unsalted water',
    'Rice, white, long grain, boiled in unsalted water', 'Rice and split peas'].map(n => ({ name: n, lc: n.toLowerCase() }));
  const cooked = A.searchGenericFoods(foods, 'white rice');
  assert.ok(/boiled/.test(cooked[0].name), 'white rice should lead with a cooked rice: ' + cooked.map(x => x.name).join(' | '));
  const raw = A.searchGenericFoods(foods, 'raw rice');
  assert.ok(/raw/.test(raw[0].name), 'asking for raw still finds raw: ' + raw.map(x => x.name).join(' | '));
});

test('search finds a food the list writes apart when it is typed together', () => {
  const foods = ['Beans, chick peas, canned, re-heated, drained', 'Peas, frozen, boiled', 'Cheese, cheddar'].map(n => ({ name: n, lc: n.toLowerCase() }));
  const r = A.searchGenericFoods(foods, 'chickpeas');
  assert.ok(r.length && /chick peas/.test(r[0].name), '"chickpeas" should find "chick peas": ' + r.map(x => x.name).join(' | '));
  assert.ok(!A.searchGenericFoods(foods, 'chickpeas').some(x => /cheddar/i.test(x.name)), 'and not unrelated foods');
});

test('common generic foods start at a real portion, raw ingredients do not', () => {
  const rice = A.typicalPortion('Rice, white, basmati, boiled in unsalted water');
  assert.ok(rice, 'cooked rice has a portion');
  assert.strictEqual(rice.g, 180);
  const porridge = A.typicalPortion('Porridge, made with milk and water');
  assert.strictEqual(porridge.label, 'bowl');
  assert.strictEqual(A.typicalPortion('Rice, white, basmati, raw'), null);
});

test('the journey band stays on Today while the egg incubates, with a weigh-in row until weighed', () => {
  const db = Store.defaultState();
  db.profile = { goalType: 'cut', weight_unit: 'kg', rateKgPerWeek: 0.5 };
  db.buddy = { hatched: false, stage: 0 };
  db.weight_entries = [{ id: 'w1', date: A.shiftISO(today, -1), scale_weight: 72 }];
  const b = A.journeyBand(db, today, true);
  assert.ok(b, 'an incubating egg is not a reason to take the plan off Today');
  assert.strictEqual(b.weighToday, true, 'not weighed today, so the row is there');
  db.weight_entries.push({ id: 'w2', date: today, scale_weight: 71.9 });
  assert.strictEqual(A.journeyBand(db, today, true).weighToday, false, 'weighed, so it is gone');
});

test('the first check-in is offered on Today even before the first trend read', () => {
  // Setup a week ago, weighed on six mornings but not yet today: no trend read (it needs seven days
  // between weigh-ins), and the check-in is due. The band used to say due: false in that state.
  const db = Store.defaultState();
  db.profile = { goalType: 'cut', weight_unit: 'kg', rateKgPerWeek: 0.5 };
  db.last_checkin = A.shiftISO(today, -7);
  for (let i = 6; i >= 1; i--) db.weight_entries.push({ id: 'w' + i, date: A.shiftISO(today, -i), scale_weight: 72 - (6 - i) * 0.1 });
  assert.equal(A.progressVerdict(db), null, 'the fixture must be short of a read');
  const b = A.journeyBand(db, today, true);
  assert.strictEqual(b.starting, true);
  assert.strictEqual(b.due, true, 'a due check-in has to be reachable from Today');
});

test('the day you check in, the next cycle starts tomorrow', () => {
  // CyclePanel says "Checked in today" off this, where it used to count "0 of 1 weigh-in" beside
  // "weighed today".
  const db = Store.defaultState();
  db.last_checkin = today;
  db.checkins = [{ date: today }];
  assert.ok(A.cycleCoverage(db, today).cs > today);
});

test('a week-old account is judged on its week, not a fortnight', () => {
  const db = Store.defaultState();
  db.profile = { goalType: 'cut', weight_unit: 'kg' };
  db.weight_entries = [{ id: 'w', date: A.shiftISO(today, -6), scale_weight: 72 }];
  assert.strictEqual(A.behaviourStats(db, 14).days, 7);
});

test('a recipe built from ingredients is priced without AI and never offered to the library', () => {
  const rec = A.buildRecipeFromParts({
    title: 'Rice and salmon', servings: 2, meal: 'dinner', method: 'Boil the rice\nBake the salmon',
    items: [
      { name: 'Rice, white, basmati, boiled in unsalted water', grams: 360, per100: { kcal: 115, protein: 2.6, carbs: 26, fat: 0.7, fiber: 0.3 } },
      { name: 'Salmon, farmed, flesh only, baked', grams: 280, per100: { kcal: 232, protein: 25.2, carbs: 0, fat: 14.6, fiber: 0 } },
      { name: 'An empty row', grams: '', per100: { kcal: 100 } },
    ],
  });
  assert.strictEqual(rec.ingredients.length, 2, 'a row with no grams is not an ingredient');
  assert.ok(rec.ingredients.every(i => i.macros && i.resolved), 'every ingredient is priced on the way in');
  assert.strictEqual(rec.source_url, '', 'no link, so submitPublicRecipe never sends it');
  assert.strictEqual(rec.tags.meal, 'dinner', 'tagged, so the background tagger has nothing to ask');
  assert.strictEqual(rec.steps.length, 2);
  // (414 + 650) kcal across two servings.
  assert.ok(Math.abs(rec.macros_per_serving.kcal - 532) <= 2, 'per-serving kcal ' + rec.macros_per_serving.kcal);
});

test('Progress reads the weekly rate the way the check-in does', () => {
  // A steady 0.1 kg a day. Endpoint to endpoint on the EMA trend this read about 0.5 kg a week, while
  // the check-in (a robust slope through the raw readings) said 0.7.
  const db = Store.defaultState();
  db.profile = { goalType: 'cut', weight_unit: 'kg' };
  for (let i = 7; i >= 0; i--) db.weight_entries.push({ id: 'w' + i, date: A.shiftISO(today, -i), scale_weight: +(72 - (7 - i) * 0.1).toFixed(2) });
  A.recomputeTrend(db);
  const r = A.trendRateKgPerWeek(db, 21);
  assert.ok(Math.abs(r + 0.7) < 0.01, 'expected -0.7 kg a week, got ' + r);
});
