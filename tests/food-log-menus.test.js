'use strict';
// The food log's ⋯ menus, pressed the way a finger presses them.
//
// Written after "the copy meal button doesn't work when on the food log trying to copy something
// like breakfast to the next day". Nothing about the copy sheet was wrong - it opened, it drew its
// calendar, and its handlers were sound. The menu it is opened FROM was the problem, and only under
// a real press.
//
// A meal's title bar is draggable: hold it and the meal comes with you, so it arms that hold on
// pointerdown. Its ⋯ button is exempted by a `data-no-mealdrag` ancestor. But the menu that button
// opens is portaled to <body>, so the exemption cannot reach it, while a React portal still bubbles
// its events through the REACT tree back into the title bar. Every tap of a menu item therefore ran
// press-and-hold on the meal, which closes the menu, and the button was unmounted before the browser
// delivered its click. The item never fired: not Copy to…, not Save as meal, not Delete meal.
//
// It survived the mounted tests because they dispatched a bare click, which no finger and no mouse
// ever sends on its own. These press with pointerdown, pointerup, click - the real sequence.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount } = require('./helpers/app.js');

const A = app();
const S = A.Store;
const today = S.todayISO();
const tomorrow = A.shiftISO(today, 1);

const MEALS = [
  { id: 'm_1', user_id: 'u', name: 'Breakfast', sort_order: 0 },
  { id: 'm_2', user_id: 'u', name: 'Lunch', sort_order: 1 },
];
const entry = (id, name, kcal) => ({
  id, user_id: 'u', date: today, meal_id: 'm_1', name, qty_label: '100 g', source: 'manual',
  computed_macros: { kcal, protein: 12, carbs: 60, fat: 8, fiber: 6 },
});
const account = () => S.migrate({
  meal_templates: MEALS,
  log_entries: [entry('e1', 'Porridge', 380), entry('e2', 'Banana', 105)],
  targets: [{ id: 't1', user_id: 'u', effective_date: today, kcal: 2400, protein_g: 180, carbs_g: 250, fat_g: 70 }],
  profile: { sex: 'male', age: 32, heightCm: 178, weightKg: 84, activityLevel: 'moderate', goalType: 'cut' },
});

// The food log, mounted, with `db` written in place so a test can read what a tap actually saved.
function foodLog(db) {
  const r = mount(A.FoodLog, { db, update: (fn) => { fn(db); }, openLog() {}, showToast() {} });
  const mealMenu = (i) => Array.from(r.host.querySelectorAll('button')).filter(b => b.getAttribute('aria-label') === 'Meal options')[i];
  return Object.assign(r, { openMealMenu: (i) => { r.tap(mealMenu(i || 0)); return r; } });
}

test('a meal\'s menu items fire when they are tapped, not just when they are clicked', () => {
  const db = account();
  const r = foodLog(db);
  try {
    r.openMealMenu(0);
    const copy = r.findEl('Copy to…');
    assert.ok(copy, 'the meal menu should be open and offering Copy to…: ' + r.doc.body.textContent.slice(0, 200));
    r.tap(copy);
    assert.ok(r.doc.body.textContent.indexOf('Quick copy to') !== -1,
      'tapping Copy to… must open the copy sheet, and did not: ' + r.doc.body.textContent.slice(0, 300));
  } finally { r.unmount(); }
});

test('copying breakfast to tomorrow puts breakfast on tomorrow', () => {
  const db = account();
  const r = foodLog(db);
  try {
    r.openMealMenu(0);
    r.tap(r.findEl('Copy to…'));
    const tom = r.findEl('Tomorrow');
    assert.ok(tom, 'the copy sheet should offer Tomorrow as a one-tap target');
    r.tap(tom);
    const copied = db.log_entries.filter(e => e.date === tomorrow);
    assert.equal(copied.length, 2, 'both breakfast items should have been copied: ' +
      JSON.stringify(db.log_entries.map(e => e.date + '/' + e.name)));
    assert.deepEqual(copied.map(e => e.name).sort(), ['Banana', 'Porridge']);
    // Into a meal that exists on the target day, or the food lands in "Unsorted" instead of Breakfast.
    for (const c of copied) assert.equal(c.meal_id, 'm_1', c.name + ' should land in Breakfast');
    // Copies, not moves: the original day keeps its food, and nothing shares an id with it.
    assert.equal(db.log_entries.filter(e => e.date === today).length, 2, 'the source day must keep its food');
    assert.equal(new Set(db.log_entries.map(e => e.id)).size, 4, 'a copied entry needs an id of its own');
  } finally { r.unmount(); }
});

test('the rest of the meal menu is alive to a tap too', () => {
  // Copy was the one that got reported; every item in that menu was dead the same way.
  const db = account();
  const r = foodLog(db);
  try {
    r.openMealMenu(0);
    r.tap(r.findEl('Save as meal'));
    assert.ok(r.doc.body.textContent.indexOf('Save this meal for one-tap logging') !== -1,
      'Save as meal should open the naming sheet: ' + r.doc.body.textContent.slice(0, 300));
  } finally { r.unmount(); }
});

test('a logged food\'s own menu copies that one item', () => {
  const db = account();
  const r = foodLog(db);
  try {
    const more = Array.from(r.host.querySelectorAll('button')).filter(b => b.getAttribute('aria-label') === 'Entry options')[0];
    r.tap(more);
    r.tap(r.findEl('Copy to…'));
    r.tap(r.findEl('Tomorrow'));
    const copied = db.log_entries.filter(e => e.date === tomorrow);
    assert.equal(copied.length, 1, 'one row copied means one entry: ' + JSON.stringify(copied.map(e => e.name)));
  } finally { r.unmount(); }
});
