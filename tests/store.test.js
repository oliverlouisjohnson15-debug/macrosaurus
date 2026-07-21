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

test('mergeStates: a live Google Health link survives a higher-_rev copy that never connected', () => {
  // The bug: a stale device/tab with a higher _rev but no googleHealth wiped a live connection on
  // merge, flipping the UI to "not connected" while the server was still synced.
  const connected = { _rev: 5, googleHealth: { connected: true, lastSync: '2026-07-21T13:44:00.000Z' } };
  const neverLinked = { _rev: 9, googleHealth: null };
  assert.strictEqual(Store.mergeStates(connected, neverLinked).googleHealth.connected, true);
  assert.strictEqual(Store.mergeStates(neverLinked, connected).googleHealth.connected, true); // order-independent
  // Two connected copies: the most recently synced one wins.
  const older = { _rev: 2, googleHealth: { connected: true, lastSync: '2026-07-20T09:00:00.000Z' } };
  const fresher = { _rev: 1, googleHealth: { connected: true, lastSync: '2026-07-21T13:44:00.000Z' } };
  assert.strictEqual(Store.mergeStates(older, fresher).googleHealth.lastSync, '2026-07-21T13:44:00.000Z');
  // An explicit disconnect (timestamped) still wins over an older connected copy.
  const live = { _rev: 3, googleHealth: { connected: true, lastSync: '2026-07-21T08:00:00.000Z' } };
  const off = { _rev: 1, googleHealth: { connected: false, disconnectedAt: '2026-07-21T12:00:00.000Z' } };
  assert.strictEqual(Store.mergeStates(live, off).googleHealth.connected, false);
});

test('mergeStates: a tombstoned delete is not resurrected by the copy that still has it', () => {
  // device A deleted entry 'a' (tombstone); device B (or the cloud) still holds 'a'.
  const deletedOn = { _rev: 3, log_entries: [{ id: 'b', date: 'x' }], deleted: { a: 999 } };
  const stillHas  = { _rev: 2, log_entries: [{ id: 'a', date: 'x' }, { id: 'b', date: 'x' }], deleted: {} };
  const m = Store.mergeStates(deletedOn, stillHas);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['b']); // 'a' stays deleted, not resurrected
  assert.ok(m.deleted.a);                                             // tombstone carried forward
  const m2 = Store.mergeStates(stillHas, deletedOn);                  // order must not matter
  assert.deepStrictEqual(m2.log_entries.map(e => e.id).sort(), ['b']);
});

test('mergeStates: tombstones only remove their own id, never other entries', () => {
  const a = { _rev: 2, log_entries: [{ id: 'x' }], deleted: { gone: 1 } };
  const b = { _rev: 1, log_entries: [{ id: 'y' }], deleted: {} };
  const m = Store.mergeStates(a, b);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['x', 'y']); // no accidental loss
});

test('mergeStates: a reset wipes old entries the union-merge would otherwise keep', () => {
  // The classic "I pressed Reset but my data and engine came back on reopen" bug. The old copy has a
  // full log + learned expenditure and a HIGHER content _rev; the reset baseline is empty but carries
  // a _wipe watermark. The merge must NOT union the old entries or engine state back in.
  const old = { _rev: 100,
    log_entries: [{ id: 'a', date: '2026-07-08' }, { id: 'b', date: '2026-07-09' }],
    weight_entries: [{ id: 'w1', date: '2026-07-08' }],
    checkins: [{ date: '2026-07-04' }], expenditure: { kcal: 2650, n: 4 } };
  const t = old._rev + 1000;
  const reset = Store.defaultState(); reset._rev = t; reset._wipe = t; // empty baseline, watermarked
  const m = Store.mergeStates(old, reset);
  assert.deepStrictEqual(m.log_entries, []);
  assert.deepStrictEqual(m.weight_entries, []);
  assert.deepStrictEqual(m.checkins, []);
  assert.strictEqual(m.expenditure, null);        // the adaptive engine is wiped too
  assert.strictEqual(m._wipe, t);                 // watermark carried forward
  const m2 = Store.mergeStates(reset, old);       // order must not matter (pre-write vs load merge)
  assert.deepStrictEqual(m2.log_entries, []);
  assert.strictEqual(m2.expenditure, null);
});

test('mergeStates: data logged AFTER a reset is kept, and two post-reset copies still union', () => {
  const t = 500;
  const base = Store.defaultState(); base._rev = t; base._wipe = t;
  // Device A logs a meal after the reset; device B logs a different one, both descend from the wipe.
  const a = JSON.parse(JSON.stringify(base)); a._rev = t + 10; a.log_entries = [{ id: 'x', date: '2026-07-18' }];
  const b = JSON.parse(JSON.stringify(base)); b._rev = t + 20; b.log_entries = [{ id: 'y', date: '2026-07-18' }];
  const m = Store.mergeStates(a, b);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['x', 'y']); // fresh entries survive & union
  // But a stale pre-reset copy still can't drag old data back in against a post-reset copy.
  const stale = { _rev: t - 50, log_entries: [{ id: 'old', date: '2026-07-01' }] };
  const m2 = Store.mergeStates(a, stale);
  assert.deepStrictEqual(m2.log_entries.map(e => e.id), ['x']);
});

test('mergeStates: null-safe', () => {
  const s = { _rev: 5, log_entries: [{ id: 'a' }] };
  assert.strictEqual(Store.mergeStates(null, s), s);
  assert.strictEqual(Store.mergeStates(s, null), s);
  assert.strictEqual(Store.mergeStates(null, null), null);
});
