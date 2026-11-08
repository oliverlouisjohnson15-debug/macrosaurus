'use strict';
// The secondary tier: nutrients tracked one step below protein, carbs and fat. Fibre is the only
// one today; the registry is built so a limit-type nutrient (sugar, salt) can join without redesign.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { app, render } = require('./helpers/app.js');

const A = app();
const SECONDARY = vm.runInContext('SECONDARY', A);

test('a goal reads "to go" with its figure against the target, then "hit", never "over"', () => {
  const r = render(A.SecondaryLine, { values: { fiber: 12 }, target: { fiber: 30 } });
  assert.match(r.text, /Fibre/);
  assert.match(r.text, /12 of 30 g/);
  assert.match(r.text, /18 g to go/);
  const past = render(A.SecondaryLine, { values: { fiber: 41 }, target: { fiber: 30 } }).text;
  assert.match(past, /hit/);
  assert.doesNotMatch(past, /over/);
});

test('an item being added counts towards the line and shows as the preview fill', () => {
  const r = render(A.SecondaryLine, { values: { fiber: 10 }, target: { fiber: 27 }, add: { fiber: 8 } });
  assert.match(r.text, /18 of 27 g/);
  assert.match(r.text, /9 g to go/);
  assert.match(r.html, /opacity:0\.45/, 'the added amount is drawn in the lighter preview fill');
});

test('the secondary meter is short: five cells, not the macros\' ten', () => {
  const r = render(A.SecondaryLine, { values: { fiber: 12 }, target: { fiber: 30 } });
  const cells = (r.html.match(/<i\b/g) || []).length;
  assert.strictEqual(cells, 5);
});

test('compact drops the meter and the "of N", and flashes what was just added', () => {
  const r = render(A.SecondaryLine, { compact: true, values: { fiber: 12 }, target: { fiber: 30 }, flash: { fiber: 3 } });
  assert.doesNotMatch(r.text, / of /);
  assert.doesNotMatch(r.html, /pip-bar/);
  assert.match(r.text, /18 g to go/);
  assert.match(r.text, /\+3 g/);
});

test('nothing is drawn without a target, and excluded keys are left out', () => {
  assert.strictEqual(render(A.SecondaryLine, { values: { fiber: 12 }, target: {} }).html, '');
  assert.strictEqual(render(A.SecondaryLine, { values: { fiber: 12 }, target: { fiber: 30 }, exclude: ['fiber'] }).html, '');
});

test('a limit reads "left" then "over", and over is muted, never the danger colour', () => {
  SECONDARY.push({ key: 'sugars', label: 'Sugar', short: 'Sug', unit: 'g', kind: 'limit', color: 'var(--carb)', ink: 'var(--carb-ink)', target: () => 30 });
  try {
    const under = render(A.SecondaryLine, { values: { fiber: 0, sugars: 20 }, target: { sugars: 30 } }).text;
    assert.match(under, /Sugar/);
    assert.match(under, /10 g left/);
    const over = render(A.SecondaryLine, { values: { sugars: 42 }, target: { sugars: 30 } });
    assert.match(over.text, /12 g over/);
    assert.doesNotMatch(over.html, /--danger/);
  } finally { SECONDARY.pop(); }
});

test('secondaryTargets reads the day\'s fibre target from the plan', () => {
  const et = { eff: { kcal: 2200 } };
  assert.deepStrictEqual(Object.assign({}, A.secondaryTargets(et)), { fiber: vm.runInContext('E', A).fiberTarget(2200).min });
  assert.deepStrictEqual(Object.assign({}, A.secondaryTargets(null)), {});
});

test('AddImpact draws the macros as full meters and fibre as the secondary line under them', () => {
  const r = render(A.AddImpact, { add: { kcal: 300, protein: 12, carbs: 40, fat: 6, fiber: 8 },
    rest: { kcal: 1200, protein: 70, carbs: 140, fat: 40, fiber: 10 }, target: { kcal: 2200, protein: 150, carbs: 250, fat: 70, fiber: 27 } });
  assert.match(r.html, /data-tier="secondary"/);
  // Four ten-cell meters (kcal, P, C, F) plus one five-cell fibre meter.
  assert.strictEqual((r.html.match(/<i\b/g) || []).length, 4 * 10 + 5);
});
