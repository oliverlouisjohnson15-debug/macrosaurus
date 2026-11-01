// Fibre we do not know yet, the energy-density stamp, and the day's fibre target.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

test('needsFibre: only unknown-fibre foods that carry carbohydrate are worth a model call', () => {
  const beans = { fiberUnknown: true, kcal: 160, carbs: 25 };
  assert.equal(E.needsFibre(beans), true);
  assert.equal(E.needsFibre({ ...beans, fiberUnknown: false }), false, 'known fibre is never re-estimated');
  assert.equal(E.needsFibre({ ...beans, carbs: 0.5 }), false, 'meat, fish, eggs and oil have none to find');
  assert.equal(E.needsFibre({ ...beans, kcal: 10 }), false, 'a squirt of sauce is not worth a call');
  assert.equal(E.needsFibre({ ...beans, is_alcohol: true }), false);
  assert.equal(E.needsFibre(null), false);
});

test('clampFibre: unusable answers are dropped, implausible ones are capped', () => {
  assert.equal(E.clampFibre(null, { kcal: 100 }), null);
  assert.equal(E.clampFibre('', { kcal: 100 }), null);
  assert.equal(E.clampFibre(NaN, { kcal: 100 }), null);
  assert.equal(E.clampFibre(-2, { kcal: 100 }), null);
  assert.equal(E.clampFibre(50, { kcal: 100 }), 10, 'no more than 20% of the energy');
  assert.equal(E.clampFibre(30, { grams: 20 }), 9, 'never more than the food can hold');
  assert.equal(E.clampFibre(3.26, { kcal: 300, grams: 150 }), 3.3, 'rounded to 0.1');
  assert.equal(E.clampFibre(0, { kcal: 300 }), 0, 'zero is a legitimate answer');
});

test('pendingFibreIds: stable, ordered, only the given date', () => {
  const e = (id, o) => Object.assign({ id, date: 'd1', fiber_pending: true }, o);
  assert.equal(E.pendingFibreIds([e('b'), e('a'), e('z', { date: 'd2' })], 'd1'), 'a,b');
});

test('edStamp: energy density per 100 g, null when it cannot be told', () => {
  assert.deepEqual(E.edStamp(200, 100), { ed: 200 });
  assert.deepEqual(E.edStamp(150, 300), { ed: 50 });
  assert.equal(E.edStamp(200, 0), null);
  assert.equal(E.edStamp(3, 100), null);
});

test('entryEd reads portions by their recorded serving weight', () => {
  const e = { unit: 'serv', amount: 2, serving_g: 50, computed_macros: { kcal: 300, protein: 10, carbs: 30, fat: 10, fiber: 2 } };
  // 300 kcal over 100 g is 300 kcal per 100 g; the profile builder uses the same figure.
  const refs = E.ownRefs([Object.assign({ id: '1', name: 'Oat bar', source: 'label', ref_type: 'food' }, e)]);
  assert.equal(Math.round(refs.measured[0].per100.kcal), 300);
});

test('fiberTarget stays inside its realistic band', () => {
  assert.equal(E.fiberTarget(1000).min, 18);
  assert.equal(E.fiberTarget(2000).min, 24);
  assert.equal(E.fiberTarget(5000).min, 38);
});
