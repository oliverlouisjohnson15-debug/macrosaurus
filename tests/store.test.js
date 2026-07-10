'use strict';
// Tests for the local store: default shape, deep-merge migration, and the calorie self-heal.
// Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Store = require('../app/store.js');

test('defaultState ships the standard meal names', () => {
  const s = Store.defaultState();
  const names = s.meal_templates.map(m => m.name);
  assert.deepStrictEqual(names, ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Other']);
});

test('migrate backfills missing keys without touching existing data', () => {
  const partial = { profile: { goalType: 'cut' }, foods: [{ id: 'x', name: 'Eggs' }] };
  const s = Store.migrate(partial);
  assert.strictEqual(s.profile.goalType, 'cut');            // preserved
  assert.ok(Array.isArray(s.log_entries));                   // backfilled
  assert.ok(s.onboarding && typeof s.onboarding === 'object'); // backfilled
  assert.strictEqual(s.foods[0].name, 'Eggs');               // array leaf preserved
});

test('migrate backfills the smoothed-expenditure field for old state shapes', () => {
  const s = Store.migrate({ profile: { goalType: 'cut' } });
  assert.ok('expenditure' in s);
  assert.strictEqual(s.expenditure, null); // null until the first check-in learns it
  const kept = Store.migrate({ expenditure: { kcal: 2650, n: 4, updated: '2026-07-01' } });
  assert.strictEqual(kept.expenditure.kcal, 2650); // existing learned value preserved
  assert.strictEqual(kept.expenditure.n, 4);
});

test('self-heal snaps grossly-inflated calories back to the macro maths', () => {
  const s = Store.migrate({
    log_entries: [
      // the real bug: 366 kcal paired with ~85 kcal of macros -> healed to 85
      { id: 'a', date: '2026-07-07', is_alcohol: false, computed_macros: { kcal: 366, protein: 15, carbs: 5.9, fat: 0.2 } },
    ],
  });
  assert.strictEqual(s.log_entries[0].computed_macros.kcal, 85);
});

test('self-heal leaves accurate and sugar-free entries alone', () => {
  const s = Store.migrate({
    log_entries: [
      { id: 'b', date: '2026-07-07', is_alcohol: false, computed_macros: { kcal: 215, protein: 7, carbs: 41, fat: 3 } }, // ~219, fine
      { id: 'c', date: '2026-07-07', is_alcohol: false, computed_macros: { kcal: 10, protein: 0, carbs: 4.4, fat: 0 } },  // sugar-free, kcal below maths
    ],
  });
  assert.strictEqual(s.log_entries[0].computed_macros.kcal, 215);
  assert.strictEqual(s.log_entries[1].computed_macros.kcal, 10);
});

test('self-heal never touches alcohol (7 kcal/g legitimately exceeds Atwater)', () => {
  const s = Store.migrate({
    log_entries: [
      { id: 'd', date: '2026-07-07', is_alcohol: true, computed_macros: { kcal: 180, protein: 0, carbs: 0, fat: 0 } },
    ],
  });
  assert.strictEqual(s.log_entries[0].computed_macros.kcal, 180);
});

test('self-heal also cleans remembered foods and saved meals', () => {
  const s = Store.migrate({
    foods: [{ id: 'f', name: 'Yog', is_alcohol: false, macros: { kcal: 366, protein: 15, carbs: 5.9, fat: 0.2 } }],
    saved_meals: [{ id: 'sm', name: 'M', items: [{ name: 'Yog', is_alcohol: false, macros: { kcal: 366, protein: 15, carbs: 5.9, fat: 0.2 } }] }],
  });
  assert.strictEqual(s.foods[0].macros.kcal, 85);
  assert.strictEqual(s.saved_meals[0].items[0].macros.kcal, 85);
});

test('mergeStates: a stale copy with a newer _rev can never drop the other copy entries', () => {
  // "good" has 3 days of food + weigh-ins; "stale" is an old copy that was re-saved (higher _rev)
  // but only holds day 1. The merge must keep ALL of good's entries. This is the data-loss guard.
  const good = { _rev: 100,
    log_entries: [{ id: 'a', date: '2026-07-08' }, { id: 'b', date: '2026-07-09' }, { id: 'c', date: '2026-07-10' }],
    weight_entries: [{ id: 'w1', date: '2026-07-08' }, { id: 'w2', date: '2026-07-09' }],
    checkins: [{ date: '2026-07-04' }, { date: '2026-07-08' }] };
  const stale = { _rev: 200, // newer timestamp, but content is old and thin
    log_entries: [{ id: 'a', date: '2026-07-08' }], weight_entries: [{ id: 'w1', date: '2026-07-08' }], checkins: [{ date: '2026-07-04' }] };
  const m = Store.mergeStates(stale, good);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['a', 'b', 'c']);
  assert.deepStrictEqual(m.weight_entries.map(e => e.id).sort(), ['w1', 'w2']);
  assert.deepStrictEqual(m.checkins.map(e => e.date).sort(), ['2026-07-04', '2026-07-08']);
  // symmetric: order of arguments must not matter for the union
  const m2 = Store.mergeStates(good, stale);
  assert.deepStrictEqual(m2.log_entries.map(e => e.id).sort(), ['a', 'b', 'c']);
});

test('mergeStates: scalar/derived fields come from the higher-_rev copy, edits win on conflict', () => {
  const older = { _rev: 1, profile: { goalType: 'cut' }, last_checkin: '2026-07-01',
    log_entries: [{ id: 'a', date: '2026-07-08', computed_macros: { kcal: 100 } }] };
  const newer = { _rev: 2, profile: { goalType: 'maintain' }, last_checkin: '2026-07-08',
    log_entries: [{ id: 'a', date: '2026-07-08', computed_macros: { kcal: 250 } }, { id: 'b', date: '2026-07-09' }] };
  const m = Store.mergeStates(older, newer);
  assert.strictEqual(m.profile.goalType, 'maintain');     // newer wins on scalars
  assert.strictEqual(m.last_checkin, '2026-07-08');
  assert.strictEqual(m.log_entries.find(e => e.id === 'a').computed_macros.kcal, 250); // newer edit wins
  assert.strictEqual(m.log_entries.length, 2);            // older's unique entries still kept
  assert.strictEqual(m._rev, 2);
});

test('mergeStates: null-safe', () => {
  const s = { _rev: 5, log_entries: [{ id: 'a' }] };
  assert.strictEqual(Store.mergeStates(null, s), s);
  assert.strictEqual(Store.mergeStates(s, null), s);
  assert.strictEqual(Store.mergeStates(null, null), null);
});
