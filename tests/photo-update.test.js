'use strict';
// Re-estimating a logged entry from a photo taken later.
//
// The brief built here is the ONLY thing that tells the model what the user already believed about
// the meal. If it comes out empty, or mangled, the re-estimate is a blind first guess and nothing
// in the UI can tell: a confident number still comes back and still gets offered for logging. So
// the shape of the sentence is pinned here rather than trusted to a React component.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const entry = (over) => Object.assign({
  id: 'e1', ref_type: 'food', name: 'Chicken katsu curry', qty_label: '0.75 of the meal',
  computed_macros: { kcal: 780, protein: 52, carbs: 74, fat: 28, fiber: 6 },
}, over || {});

test('the brief names the food, the amount and every macro it has', () => {
  const s = E.priorEstimateBrief(entry());
  assert.ok(s.includes('"Chicken katsu curry"'), s);
  assert.ok(s.includes('(0.75 of the meal)'), s);
  assert.ok(s.includes('780 kcal'), s);
  ['52 g protein', '74 g carbs', '28 g fat', '6 g fibre'].forEach(p => assert.ok(s.includes(p), `${p} missing from ${s}`));
});

test('a macro that is zero or missing is left out, not sent as a measured zero', () => {
  const s = E.priorEstimateBrief(entry({ computed_macros: { kcal: 240, protein: 0, carbs: 60, fat: 0 } }));
  assert.ok(s.includes('240 kcal') && s.includes('60 g carbs'), s);
  assert.ok(!/protein/.test(s), `an absent protein figure must not be stated: ${s}`);
  assert.ok(!/fat/.test(s), `an absent fat figure must not be stated: ${s}`);
  assert.ok(!/fibre/.test(s), `an absent fibre figure must not be stated: ${s}`);
});

test('an entry with no amount recorded still describes itself', () => {
  const s = E.priorEstimateBrief(entry({ qty_label: '' }));
  assert.ok(s.startsWith('"Chicken katsu curry": '), s);
  assert.ok(!s.includes('()'), `an empty amount must not leave empty brackets: ${s}`);
});

test('fractional macros keep one decimal rather than rounding away to nothing', () => {
  const s = E.priorEstimateBrief(entry({ computed_macros: { kcal: 90, protein: 0.4, carbs: 2.25, fat: 0 } }));
  assert.ok(s.includes('0.4 g protein'), s);
  assert.ok(s.includes('2.3 g carbs'), s);
});

test('nothing to describe returns an empty string, never a sentence about nothing', () => {
  assert.equal(E.priorEstimateBrief(null), '');
  assert.equal(E.priorEstimateBrief({}), '');
  assert.equal(E.priorEstimateBrief({ name: '   ' }), '');
});

test('an entry with a name but no numbers is still worth describing', () => {
  assert.equal(E.priorEstimateBrief({ name: 'Leftover chilli' }), '"Leftover chilli".');
});

test('food can be re-estimated from a photo; alcohol cannot', () => {
  assert.equal(E.photoUpdatable(entry()), true);
  assert.equal(E.photoUpdatable(entry({ is_alcohol: true, ref_type: 'alcohol' })), false,
    'a drink\'s calories are split by slider, not estimated, and must not be overwritten');
  assert.equal(E.photoUpdatable(null), false);
});

test('an entry logged before ref_type existed is still food', () => {
  assert.equal(E.photoUpdatable({ name: 'Porridge', computed_macros: { kcal: 300 } }), true);
});
