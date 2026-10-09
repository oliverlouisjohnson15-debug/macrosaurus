'use strict';
// The log sheet's "Left today" strip, after a one-tap +.
//
// `left.kcal` used to subtract the foods added this sitting on top of a day total that already
// contained them (the sheet re-reads the diary on every render, and the add has written to it), so
// the first + took twice its calories off the strip while protein, carbs and fat moved correctly.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount } = require('./helpers/app.js');

const A = app();
const S = A.Store;
const today = S.todayISO();

const account = () => S.migrate({
  meal_templates: [{ id: 'm_1', user_id: 'u', name: 'Breakfast', sort_order: 0 }],
  log_entries: [],
  foods: [{ id: 'f1', name: 'Porridge', source: 'manual', is_alcohol: false, is_favorite: false, last_qty: '1 bowl',
    macros: { kcal: 400, protein: 20, carbs: 60, fat: 8, fiber: 5 }, updated_at: 1 }],
  targets: [{ id: 't1', user_id: 'u', effective_date: today, kcal: 2400, protein_g: 180, carbs_g: 250, fat_g: 70 }],
  profile: { sex: 'male', age: 32, heightCm: 178, weightKg: 84, activityLevel: 'moderate', goalType: 'cut' },
});

test('one-tap + takes exactly the food\'s calories off "Left today", once', () => {
  const db = account();
  const addEntry = (mealId, item) => {
    db.log_entries.push({ id: 'e' + db.log_entries.length, user_id: 'u', date: today, meal_id: mealId, name: item.name,
      qty_label: item.qtyLabel || '', source: item.source, computed_macros: item.macros });
  };
  const r = mount(A.LogSheet, { db, update: (fn) => fn(db), meals: db.meal_templates, target: { date: today, mealId: 'm_1' },
    onAdd: addEntry, onAddMeal() {}, onAddItems() {}, onClose() {}, isPremium: false, aiCalls: 0 });
  try {
    const before = /Left today\s*([\d,]+)/.exec(r.text);
    assert.ok(before, 'the strip should show what is left: ' + r.text.slice(0, 200));
    const start = +before[1].replace(/,/g, '');
    const plus = Array.from(r.host.ownerDocument.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Add Porridge');
    assert.ok(plus, 'the recent should offer a +');
    r.tap(plus);
    const after = +/(?:Left|Over) today\s*([\d,]+)/.exec(r.text)[1].replace(/,/g, '');
    assert.strictEqual(start - after, 400, 'kcal left should fall by the food\'s 400, not twice that: ' + start + ' -> ' + after);
  } finally { r.unmount(); }
});
