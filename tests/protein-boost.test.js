'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const base = { sex: 'male', weightKg: 92.5, heightCm: 175, age: 32, avgSteps: 8000, gymSessionsPerWeek: 3,
  bodyFatPct: 26, dietStyle: 'balanced', goalType: 'cut', rateKgPerWeek: 0.5, proteinMode: 'perkg' };
const impliedKcal = (m) => m.protein_g * 4 + m.fat_g * 9 + m.carbs_g * 4 + E.fiberReserveKcal(m.kcal);

test('boost off or missing leaves macros identical, for every diet style', () => {
  for (const dietStyle of ['balanced', 'lower_carb', 'higher_carb']) {
    const p = Object.assign({}, base, { dietStyle });
    const a = E.macrosFromKcal(2200, p);
    assert.deepStrictEqual(E.macrosFromKcal(2200, Object.assign({}, p, { proteinBoostG: 0 })), a);
    assert.strictEqual(a.proteinBoost, undefined);
  }
});

test('+10 g adds protein, keeps calories, trims fat and carbs', () => {
  const a = E.macrosFromKcal(3000, base);
  const b = E.macrosFromKcal(3000, Object.assign({}, base, { proteinBoostG: 10 }));
  assert.strictEqual(b.protein_g, a.protein_g + 10);
  assert.strictEqual(b.kcal, a.kcal);
  assert.ok(b.fat_g < a.fat_g && b.carbs_g < a.carbs_g);
  assert.ok(Math.abs(impliedKcal(b) - impliedKcal(a)) <= 6);
  assert.strictEqual(b.proteinBoost.applied, 10);
});

test('fat on its floor: the whole boost comes from carbs', () => {
  // 2,200 kcal balanced for this profile puts fat at the 0.8 g/kg floor already.
  const a = E.macrosFromKcal(2200, base), b = E.macrosFromKcal(2200, Object.assign({}, base, { proteinBoostG: 10 }));
  assert.strictEqual(a.fat_g, Math.round(0.8 * base.weightKg));
  assert.strictEqual(b.fat_g, a.fat_g);
  assert.ok(b.carbs_g < a.carbs_g && b.protein_g === a.protein_g + 10);
});

test('squeezed budget: boost is not applied', () => {
  const p = Object.assign({}, base, { weightKg: 120, bodyFatPct: 12 });
  const a = E.macrosFromKcal(1500, p), b = E.macrosFromKcal(1500, Object.assign({}, p, { proteinBoostG: 20 }));
  assert.strictEqual(a.squeezed, true);
  assert.strictEqual(b.protein_g, a.protein_g);
  assert.strictEqual(b.proteinBoost.applied, 0);
});

test('exact-grams mode ignores the boost', () => {
  const p = Object.assign({}, base, { proteinManualG: 180 });
  assert.strictEqual(E.macrosFromKcal(2200, Object.assign({}, p, { proteinBoostG: 20 })).protein_g, E.macrosFromKcal(2200, p).protein_g);
});

test('boost never passes the manual ceiling', () => {
  const p = Object.assign({}, base, { proteinMode: 'adaptive', bodyFatPct: 10 });
  const max = E.proteinManualBounds(p).max;
  assert.ok(E.macrosFromKcal(3500, Object.assign({}, p, { proteinBoostG: 20 })).protein_g <= max);
});

test('normProteinBoost cleans odd values', () => {
  const n = (v) => E.normProteinBoost({ proteinBoostG: v });
  assert.deepStrictEqual([7, -5, '10', 999, 'x', undefined].map(n), [5, 0, 10, 20, 0, 0]);
});

test('applyKcalDelta keeps the boosted protein on high and low days', () => {
  const b = E.macrosFromKcal(2200, Object.assign({}, base, { proteinBoostG: 10 }));
  assert.strictEqual(E.applyKcalDelta(b, 200).protein_g, b.protein_g);
  assert.strictEqual(E.applyKcalDelta(b, -200).protein_g, b.protein_g);
});
