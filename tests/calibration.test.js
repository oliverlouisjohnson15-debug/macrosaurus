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
const Cofid = require('../app/cofid.js');

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

/* The strongest check available offline: expected macros must reconcile with expected calories
   under the UK label convention (protein 4, carbohydrate 4, fat 9, fibre 2; Reg. 1169/2011 Annex
   XIV), which is now the ONE basis everything in this app speaks.

   It did not used to be. CoFID publishes carbohydrate as monosaccharide equivalents and energises
   fibre at 0 kcal, so its rows failed this check honestly until Cofid.toLabelBasis started
   converting them at load. That mismatch was not only a test problem: the prompt tells the model to
   answer on the label convention, so the old fixture marked correct answers wrong. */
const labelKcal = (e) => Q.atwater({ protein: e.protein, carbs: e.carbs, fat: e.fat, fiber: e.fiber || 0 });

test('expected macros reconcile with expected calories on the label basis', () => {
  for (const c of all) {
    const sum = labelKcal(c.expect);
    const drift = Math.abs(sum - c.expect.kcal) / c.expect.kcal;
    // Tight for converted CoFID, where the arithmetic is exact and any drift is a generator bug.
    // Looser for published chain figures, which round hard and usually omit fibre.
    const tol = c.confidence === 'measured' ? 0.03 : 0.15;
    assert.ok(drift <= tol, `${c.id}: ${c.expect.kcal} kcal but macros sum to ${sum.toFixed(0)} (${(drift * 100).toFixed(1)}% off, tolerance ${tol * 100}%)`);
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
      kcal += Cofid.toLabelBasis({ protein: row[2], carbs: row[3], fat: row[4], fiber: row[5], sugars: row[7] }).kcal * (+m[2]) / 100;
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
    const expected = Math.round(Cofid.toLabelBasis({ protein: row[2], carbs: row[3], fat: row[4], fiber: row[5], sugars: row[7] }).kcal * c.grams / 100);
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
