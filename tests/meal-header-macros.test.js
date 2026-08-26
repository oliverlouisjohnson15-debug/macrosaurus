'use strict';
// A meal heading reports its own protein, carbs and fat, not just its calories.
//
// The heading used to carry calories alone, on the argument that the day card, the meal header and
// the food row would otherwise repeat one breakdown three times. The meal is the level a decision
// is actually made at ("breakfast was 24 g of protein, so lunch needs to be bigger"), and working
// that out meant adding the rows up by eye.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount } = require('./helpers/app.js');

const A = app();
const S = A.Store;
const today = S.todayISO();

const MEALS = [
  { id: 'm_1', user_id: 'u', name: 'Breakfast', sort_order: 0 },
  { id: 'm_2', user_id: 'u', name: 'Lunch', sort_order: 1 },
];
const entry = (id, name, macros) => ({
  id, user_id: 'u', date: today, meal_id: 'm_1', name, qty_label: '100 g', source: 'manual',
  computed_macros: macros,
});
const account = () => S.migrate({
  meal_templates: MEALS,
  // 195 + 10 kcal, 24 + 0 protein, 12 + 5 carbs, 5 + 0 fat.
  log_entries: [
    entry('e1', 'Protein Milkshake', { kcal: 195, protein: 24, carbs: 12, fat: 5, fiber: 1 }),
    entry('e2', 'Monster Energy Ultra', { kcal: 10, protein: 0, carbs: 5, fat: 0, fiber: 0 }),
  ],
  targets: [{ id: 't1', user_id: 'u', effective_date: today, kcal: 2400, protein_g: 180, carbs_g: 250, fat_g: 70 }],
  profile: { sex: 'male', age: 32, heightCm: 178, weightKg: 84, activityLevel: 'moderate', goalType: 'cut' },
});
const foodLog = (db) => mount(A.FoodLog, { db, update: (fn) => { fn(db); }, openLog() {}, showToast() {} });

// A meal card marks itself for the drag code, and its title bar is the one --cardhead-bg ground
// inside it - between them a test can find the heading without depending on the rest of the markup.
// (The day-total card at the top of the page has a title bar too, hence the data-meal-card scope.)
function mealHeads(r) {
  return Array.from(r.host.querySelectorAll('[data-meal-card]'))
    .map(c => Array.from(c.querySelectorAll('div')).find(d => (d.getAttribute('style') || '').indexOf('--cardhead-bg') !== -1));
}

test('a meal heading totals the macros of the food in it', () => {
  const db = account();
  const r = foodLog(db);
  try {
    const head = mealHeads(r)[0];
    assert.ok(head, 'the food log should draw a meal title bar');
    const txt = head.textContent.replace(/\s+/g, ' ');
    assert.ok(txt.indexOf('205 kcal') !== -1, 'breakfast should still report its calories: ' + txt);
    assert.ok(/P\s*24/.test(txt), 'breakfast should total 24 g of protein: ' + txt);
    assert.ok(/C\s*17/.test(txt), 'breakfast should total 17 g of carbs: ' + txt);
    assert.ok(/F\s*5/.test(txt), 'breakfast should total 5 g of fat: ' + txt);
  } finally { r.unmount(); }
});

test('the macros are drawn in the on-bar colours, never the ink ones', () => {
  // The ink tokens are the dark-on-light pass: --pro-ink measures 2.0:1 on the title bar. Using them
  // here would be an invisible line, so this is worth pinning rather than trusting to review.
  const db = account();
  const r = foodLog(db);
  try {
    const head = mealHeads(r)[0];
    const styles = Array.from(head.querySelectorAll('span')).map(s => s.getAttribute('style') || '').join(' ');
    for (const t of ['--pro-on-head', '--carb-on-head', '--fat-on-head']) {
      assert.ok(styles.indexOf(t) !== -1, 'the heading should colour its macros with ' + t);
    }
    for (const t of ['--pro-ink', '--carb-ink', '--fat-ink']) {
      assert.ok(styles.indexOf(t) === -1, t + ' is unreadable on the title bar and must not appear there');
    }
  } finally { r.unmount(); }
});

test('an empty meal keeps its dash and gains no P0 C0 F0', () => {
  // An empty meal is an invitation, not a report. Zeroed macros are that same lazy placeholder the
  // dash exists to avoid, three times over.
  const db = account();
  const r = foodLog(db);
  try {
    const lunch = mealHeads(r)[1];
    assert.ok(lunch, 'Lunch should be on the day even with nothing in it');
    const txt = lunch.textContent.replace(/\s+/g, ' ');
    assert.ok(txt.indexOf('–') !== -1, 'an empty meal should keep its dash: ' + txt);
    assert.ok(!/P\s*0/.test(txt), 'an empty meal should not report zeroed macros: ' + txt);
  } finally { r.unmount(); }
});
