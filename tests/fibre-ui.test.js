'use strict';
// Fibre in the UI: the shared "what adding this does" panel, the fibre states, and the week strip.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, render } = require('./helpers/app.js');

const A = app();
const S = A.Store;
const today = S.todayISO();

const REST = { kcal: 1200, protein: 70, carbs: 140, fat: 40, fiber: 10 };
const TARGET = { kcal: 2200, protein: 150, carbs: 250, fat: 70, fiber: 27 };

test('AddImpact says what the item is and where fibre leaves the day', () => {
  const html = render(A.AddImpact, { add: { kcal: 300, protein: 12, carbs: 40, fat: 6, fiber: 8 }, rest: REST, target: TARGET, label: 'Adding 1 bowl' }).text;
  assert.match(html, /Adding 1 bowl/);
  assert.match(html, /P12/); assert.match(html, /C40/); assert.match(html, /F6/);
  assert.match(html, /Fib 8/);
  assert.match(html, /Today after this/);
  // 27 - 10 - 8 = 9 to go. Fibre is a goal, never an overshoot.
  assert.match(html, /9 g to go/);
});

test('fibre past the goal reads "hit", never "over"', () => {
  const html = render(A.AddImpact, { add: { kcal: 100, protein: 1, carbs: 10, fat: 1, fiber: 30 }, rest: REST, target: TARGET }).text;
  assert.match(html, /hit/);
  assert.doesNotMatch(html, /Fibre[^]*g over/);
});

test('unknown fibre is a question mark, never a confident 0', () => {
  const unknown = render(A.MacroStrip, { m: { protein: 5, carbs: 20, fat: 2, fiber: 0 }, fibre: { state: 'unknown' } }).text;
  assert.match(unknown, /Fib \?/);
  const est = render(A.MacroStrip, { m: { protein: 5, carbs: 20, fat: 2, fiber: 4.26 }, fibre: { state: 'est' } }).text;
  assert.match(est, /Fib ~4\.3/);
  const pending = render(A.MacroStrip, { m: { protein: 5, carbs: 20, fat: 2, fiber: 0 }, fibre: { state: 'pending' } }).text;
  assert.match(pending, /Fib …/);
  const none = render(A.MacroStrip, { m: { protein: 5, carbs: 20, fat: 2, fiber: 0 } }).text;
  assert.match(none, /Fib 0/, 'a known zero is still shown as zero');
});

test('with no day to compare against only the item is drawn; alcohol has no fibre row', () => {
  const bare = render(A.AddImpact, { add: { kcal: 300, protein: 12, carbs: 40, fat: 6, fiber: 3 } }).text;
  assert.doesNotMatch(bare, /Today after this/);
  const drink = render(A.AddImpact, { add: { kcal: 150, protein: 0, carbs: 8, fat: 4 }, rest: REST, target: TARGET, noFibre: true }).text;
  assert.doesNotMatch(drink, /Fib/);
  assert.doesNotMatch(drink, /Fibre/);
});

test('entryFibreState: pending is unknown for free and on its way for Premium', () => {
  assert.strictEqual(A.entryFibreState({ fiber_est: true }), 'est');
  assert.strictEqual(A.entryFibreState({}), 'known');
  assert.strictEqual(A.entryFibreState({ fiber_pending: true }), 'unknown');
});

test('the week strip counts days that reached the fibre goal and leaves unlogged days as gaps', () => {
  const day = (ago, fiber, kcal = 2000) => ({ id: 'e' + ago, user_id: 'u', date: S.addDays ? S.addDays(today, -ago) : new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10),
    meal_id: 'm_1', name: 'x', computed_macros: { kcal, protein: 100, carbs: 200, fat: 60, fiber } });
  const db = S.migrate({
    meal_templates: [{ id: 'm_1', user_id: 'u', name: 'Breakfast', sort_order: 0 }],
    log_entries: [day(0, 30), day(1, 10), day(2, 40)],
    targets: [{ id: 't1', user_id: 'u', effective_date: '2020-01-01', kcal: 2000, protein_g: 150, carbs_g: 250, fat_g: 70 }],
    profile: { sex: 'male', age: 32, heightCm: 178, weightKg: 84, activityLevel: 'moderate', goalType: 'cut' },
  });
  const html = render(A.FibreWeekCard, { db }).text;
  assert.match(html, /2\/7/, 'two of the three logged days reached 24 g: ' + html);
  assert.match(html, /2 of 3 logged days/);
});

test('the grams switch survives an entry that never stored its portion weight', () => {
  const entry = { id: 'e1', name: 'Cheddar', qty_label: '1 portion (30 g)', amount: 1, unit: 'serv', unit_noun: 'portion (30 g)',
    computed_macros: { kcal: 78, protein: 9, carbs: 0, fat: 5, fiber: 0 } };
  const html = render(A.EditEntryModal, { entry, onSave() {}, onClose() {} }).text;
  assert.match(html, /Measure in/, 'the unit switch should be offered: ' + html.slice(0, 300));
  assert.match(html, /Grams/);
});
