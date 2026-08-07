'use strict';
// Guards the calibration set itself. tools/calibrate.mjs needs an API key and cannot run in CI, but
// the ground truth it measures against can and must be checked here: a calibration set with wrong
// truth is worse than no calibration set, because it produces confident, wrong verdicts about
// whether a prompt change helped.
//
// Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Q = require('../app/quantity.js');

const root = path.join(__dirname, '..');
const fx = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/calibration.json'), 'utf8'));
const FOODS = JSON.parse(fs.readFileSync(path.join(root, 'foods-uk.json'), 'utf8')).foods;
const all = [].concat(fx.knowledge, fx.composite || [], fx.chain, fx.portion || []);

test('the calibration set is populated', () => {
  assert.ok(fx.knowledge.length >= 12, `only ${fx.knowledge.length} knowledge cases`);
  assert.ok(fx.chain.length >= 1);
});

test('every case is well formed', () => {
  const ids = new Set();
  for (const c of all) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`);
    ids.add(c.id);
    assert.ok(c.text && c.text.length > 3, `${c.id}: no description`);
    assert.ok(c.truth, `${c.id}: no stated source of truth`);
    assert.ok(c.expect && c.expect.kcal > 0, `${c.id}: no expected calories`);
    for (const k of ['protein', 'carbs', 'fat']) {
      assert.ok(typeof c.expect[k] === 'number' && c.expect[k] >= 0, `${c.id}: bad ${k}`);
    }
  }
});

// The description has to name the weight, because that is the whole point of the knowledge cases:
// they hold portion constant so the nutrition knowledge is what gets measured.
test('knowledge cases state their weight in the text the model sees', () => {
  for (const c of fx.knowledge) {
    assert.ok(/\d/.test(c.text), `${c.id}: description names no amount`);
    assert.ok(c.grams > 0, `${c.id}: no grams`);
  }
});

/* The strongest check available offline: expected macros must reconcile with expected calories.
   Each source has to be reconciled under ITS OWN energy convention, which is not the same one.

   A UK label, and therefore the whole app, uses protein 4, carbohydrate 4, fat 9, fibre 2 (Reg.
   1169/2011 Annex XIV), with carbohydrate declared excluding fibre.

   CoFID does not. It expresses carbohydrate as MONOSACCHARIDE EQUIVALENTS, energised at 3.75 kcal/g,
   and its energy values assign fibre 0 kcal, predating the 2011 rule. Fitted across the 1,378 CoFID
   rows carrying all four values, `protein*4 + carbs*3.75 + fat*9` lands within 5% on 97% of them
   (median error 0.14%); a flat 4/4/9 plus fibre*2 manages only 60%. So checking CoFID-derived truth
   with the label formula would fail honest rows and pass typos, which is backwards. */
const labelKcal = (e) => Q.atwater({ protein: e.protein, carbs: e.carbs, fat: e.fat, fiber: e.fiber || 0 });
const cofidKcal = (e) => e.protein * 4 + e.carbs * 3.75 + e.fat * 9;

test('expected macros reconcile with expected calories, each under its own convention', () => {
  for (const c of all) {
    const measured = c.confidence === 'measured';
    const sum = measured ? cofidKcal(c.expect) : labelKcal(c.expect);
    const drift = Math.abs(sum - c.expect.kcal) / c.expect.kcal;
    // Tight for CoFID, where the convention is known exactly and any real drift is a generator bug.
    // Looser for published chain figures, which round hard and omit fibre.
    const tol = measured ? 0.06 : 0.15;
    assert.ok(drift <= tol, `${c.id}: ${c.expect.kcal} kcal but macros sum to ${sum.toFixed(0)} under the ${measured ? 'CoFID' : 'label'} convention (${(drift * 100).toFixed(1)}% off, tolerance ${tol * 100}%)`);
  }
});

// The generated cases claim to come from CoFID. This proves it, and fails if foods-uk.json is
// regenerated and a row moves or changes, rather than letting the truth silently drift.
// A composite's truth is the sum of its parts, so it must reconcile against those same rows. This
// is what catches a component being added to the description but not to the truth.
test('composite cases equal the sum of the CoFID rows they name', () => {
  for (const c of fx.composite || []) {
    const parts = String(c.truth).replace(/^CoFID sum:\s*/, '').split(' + ');
    assert.strictEqual(parts.length, c.components, `${c.id}: names ${parts.length} parts but claims ${c.components}`);
    let kcal = 0, grams = 0;
    for (const part of parts) {
      const m = part.match(/^(.*) @ (\d+) g$/);
      assert.ok(m, `${c.id}: unparseable component "${part}"`);
      const row = FOODS.find(f => f[0] === m[1]);
      assert.ok(row, `${c.id}: CoFID row gone: "${m[1]}"`);
      kcal += row[1] * (+m[2]) / 100;
      grams += +m[2];
    }
    assert.strictEqual(c.expect.kcal, Math.round(kcal), `${c.id}: expects ${c.expect.kcal} kcal, parts sum to ${Math.round(kcal)}`);
    assert.strictEqual(c.grams, grams, `${c.id}: grams do not match the parts`);
  }
});

test('knowledge cases still match the CoFID rows they were generated from', () => {
  for (const c of fx.knowledge) {
    const name = String(c.truth).replace(/^CoFID:\s*/, '');
    const row = FOODS.find(f => f[0] === name);
    assert.ok(row, `${c.id}: CoFID row gone: "${name}"`);
    const expected = Math.round(row[1] * c.grams / 100);
    assert.strictEqual(c.expect.kcal, expected, `${c.id}: expects ${c.expect.kcal} kcal, CoFID gives ${expected} for ${c.grams} g`);
  }
});

// Provenance is not decoration: it decides how much a regression here is worth believing. CoFID is
// laboratory data; a chain's published figure relayed by an aggregator is not.
test('every case declares how good its truth is', () => {
  const ok = new Set(['measured', 'published-secondary', 'weighed']);
  for (const c of all) {
    assert.ok(ok.has(c.confidence), `${c.id}: unknown confidence "${c.confidence}"`);
  }
});

test('the target is set at something achievable', () => {
  // Research models with depth data reach 13.5-15.3% MAPE on Nutrition5k. A target tighter than that
  // would be aspirational nonsense for a single photo through a general vision model.
  assert.ok(fx.targets.kcal_mape >= 0.15 && fx.targets.kcal_mape <= 0.3);
});
