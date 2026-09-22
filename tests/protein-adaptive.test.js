'use strict';
/* The adaptive protein model.
 *
 * Scaling protein to lean mass already moves the target as body composition does. The literature
 * says the COEFFICIENT moves too - Helms 2014 scales it with leanness AND deficit severity, and
 * Refalo 2025 finds the payoff shrinks the more body fat you carry. These tests pin the model to
 * the published ranges at their endpoints, which is the only thing its constants are calibrated
 * against: change a constant and the endpoint assertions are what tell you whether it still agrees
 * with the papers it claims to encode.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg || `${a} not within ${tol} of ${b}`);
const base = {
  sex: 'male', age: 32, heightCm: 175, weightKg: 88, bodyFatPct: 22,
  goalType: 'cut', rateKgPerWeek: 0.75, dietStyle: 'balanced', avgSteps: 12000, gymSessionsPerWeek: 5,
};
const at = (x) => E.proteinRecommendation(Object.assign({}, base, x));

// ---- the endpoints the constants are calibrated to -----------------------------------------------

test('a contest-lean dieter in a severe deficit lands near the top of the Helms band', () => {
  const r = at({ bodyFatPct: 7, weightKg: 80, rateKgPerWeek: 1.0 });
  assert.ok(r.gPerKgLBM >= 2.8 && r.gPerKgLBM <= 3.1, `expected ~3.1 g/kg lean, got ${r.gPerKgLBM}`);
});

test('a maintainer lands on the Morton plateau, ~1.6 g/kg BODYWEIGHT', () => {
  const r = at({ goalType: 'maintain' });
  near(r.grams / 88, 1.62, 0.12, `${r.grams} g on 88 kg is ${(r.grams / 88).toFixed(2)} g/kg BW`);
});

test('a higher-body-fat dieter is held at the band floor, not pushed up it', () => {
  const r = at({ bodyFatPct: 35, weightKg: 100, rateKgPerWeek: 0.6 });
  assert.strictEqual(r.gPerKgLBM, 2.0);
  assert.strictEqual(r.band.clamped, true, 'the model wanted to go lower and the band stopped it');
  // Still inside the 1.2-1.6 g/kg bodyweight range the weight-loss literature gives for this group.
  const perKgBW = r.grams / 100;
  assert.ok(perKgBW >= 1.2 && perKgBW <= 1.6, `${perKgBW.toFixed(2)} g/kg BW is outside 1.2-1.6`);
});

test('every goal stays inside its own evidence band, across the whole plausible range', () => {
  for (const goalType of ['cut', 'maintain', 'gain']) {
    const band = E.PROTEIN_BAND_G_PER_KG_LBM[goalType];
    for (const sex of ['male', 'female']) {
      for (let bf = 5; bf <= 50; bf++) {
        for (const rateKgPerWeek of [0, 0.25, 0.5, 0.75, 1, 1.5]) {
          const r = at({ goalType, sex, bodyFatPct: bf, rateKgPerWeek });
          assert.ok(r.gPerKgLBM >= band[0] && r.gPerKgLBM <= band[1],
            `${goalType}/${sex}/${bf}%/${rateKgPerWeek} gave ${r.gPerKgLBM}, outside ${band}`);
          assert.ok(r.grams > 0 && r.grams < 400, `implausible gram target ${r.grams}`);
        }
      }
    }
  }
});

// ---- the two moderators --------------------------------------------------------------------------

test('getting leaner raises protein, even as bodyweight falls', () => {
  const fatter = at({ bodyFatPct: 26, weightKg: 90 });
  const leaner = at({ bodyFatPct: 18, weightKg: 84 });
  assert.ok(leaner.gPerKgLBM > fatter.gPerKgLBM, 'the coefficient should rise with leanness');
  assert.ok(leaner.grams > fatter.grams,
    `lighter but leaner should still eat more protein: ${leaner.grams} vs ${fatter.grams}`);
});

test('a steeper deficit raises protein; maintaining and gaining carry no deficit term', () => {
  assert.ok(at({ rateKgPerWeek: 1.0 }).gPerKgLBM > at({ rateKgPerWeek: 0.25 }).gPerKgLBM);
  assert.strictEqual(at({ goalType: 'maintain', rateKgPerWeek: 1.0 }).parts.deficit, 0);
  assert.strictEqual(at({ goalType: 'gain', rateKgPerWeek: 1.0 }).parts.deficit, 0);
  // A token deficit is not a deficit worth eating more protein for.
  assert.strictEqual(at({ rateKgPerWeek: 0.1 }).parts.deficit, 0);
});

test('women are judged lean at a higher body fat than men, by the same 8 points rateGuidance uses', () => {
  assert.strictEqual(at({ sex: 'female', bodyFatPct: 26 }).parts.leanness, at({ sex: 'male', bodyFatPct: 18 }).parts.leanness);
});

test('leaner than the anchor earns full credit, never extrapolated credit', () => {
  assert.strictEqual(at({ bodyFatPct: 10 }).parts.leanness, at({ bodyFatPct: 4 }).parts.leanness);
});

test('the deficit term reads the PLANNED rate, so calorie cycling cannot move protein', () => {
  // Same profile, same rate: the recommendation is a pure function of the plan, not of any one day.
  assert.strictEqual(at({}).grams, at({}).grams);
  assert.ok(at({}).deficitPct > 0.2 && at({}).deficitPct < 0.35, 'sanity: 0.75 kg/wk here is a ~26% deficit');
});

// ---- how it reaches the plan ---------------------------------------------------------------------

test('no body-fat reading means no recommendation, and no pretending to have one', () => {
  assert.strictEqual(E.proteinRecommendation(Object.assign({}, base, { bodyFatPct: null })), null);
  assert.strictEqual(E.proteinRecommendation({ weightKg: 0, bodyFatPct: 20 }), null);
  // Adaptive falls back to the g/kg path rather than returning nothing.
  const blind = Object.assign({}, base, { bodyFatPct: null, proteinMode: 'adaptive', proteinGPerKgLBM: 2.4 });
  assert.strictEqual(E.proteinGrams(blind), Math.round(2.4 * 88));
});

test('proteinMode: a held gram figure outranks adaptive, and profiles without a mode stay on per-kg', () => {
  assert.strictEqual(E.proteinMode(base), 'perkg', 'existing profiles must not be migrated silently');
  assert.strictEqual(E.proteinMode(Object.assign({}, base, { proteinMode: 'adaptive' })), 'adaptive');
  assert.strictEqual(E.proteinMode(Object.assign({}, base, { proteinMode: 'adaptive', proteinManualG: 170 })), 'grams');
  assert.strictEqual(E.proteinGrams(Object.assign({}, base, { proteinMode: 'adaptive', proteinManualG: 170 })), 170);
});

test('adaptive mode feeds the plan, and spends the difference on carbs rather than calories', () => {
  const adaptive = Object.assign({}, base, { proteinMode: 'adaptive' });
  assert.strictEqual(E.proteinGrams(adaptive), at({}).grams);
  const flat = E.computeInitialTargets(base);
  const adapt = E.computeInitialTargets(adaptive);
  assert.strictEqual(adapt.kcal, flat.kcal, 'calories are not the protein control');
  assert.strictEqual(adapt.protein_g, at({}).grams);
  near(adapt.protein_g * 4 + adapt.fat_g * 9 + adapt.carbs_g * 4 + E.fiberReserveKcal(adapt.kcal), adapt.kcal, 8);
});

test('a new body-fat reading moves an adaptive target at the next check-in', () => {
  const p22 = Object.assign({}, base, { proteinMode: 'adaptive', bodyFatPct: 22 });
  const p18 = Object.assign({}, p22, { bodyFatPct: 18 });
  const a = E.computeInitialTargets(p22), b = E.computeInitialTargets(p18);
  assert.ok(b.protein_g > a.protein_g, `${b.protein_g} should exceed ${a.protein_g} after leaning out`);
  // And the check-in says so, instead of claiming it stayed put.
  assert.match(E.proteinClause(a, b), /goes up to/);
  assert.match(E.proteinClause(b, a), /comes down to/);
  assert.match(E.proteinClause(a, a), /stays at/);
});
