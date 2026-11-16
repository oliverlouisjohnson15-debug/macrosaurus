'use strict';
// Finding a machine you have saved, so it is never saved again because it could not be found.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;
const custom = [
  { id: 'cu_a', name: 'Incline press', brand: 'Hammer Strength', variantOf: 'machine_incline', equipment: 'machine', primary: ['ch'], custom: true },
  { id: 'cu_b', name: 'Hoist pec deck', brand: 'Hoist', variantOf: 'pec_deck', equipment: 'machine', primary: ['ch'], custom: true },
];

test('a saved machine is found by its brand, its name, or the words in any order, and comes first', () => {
  assert.deepEqual(T.search('hammer strength', custom, 10).map(e => e.id), ['cu_a']);
  assert.equal(T.search('incline press', custom, 10)[0].id, 'cu_a');
  assert.equal(T.search('press incline', custom, 10)[0].id, 'cu_a');
  assert.ok(T.search('incline press', custom, 10).some(e => e.id === 'machine_incline'), '"incline press" finds Incline machine press');
  assert.ok(!T.search('row', null, 40).some(e => /narrow/i.test(e.name)), 'word starts, so "row" is not inside "narrow"');
});

test('your exercises are most recently used first, never-used last', () => {
  const logs = [{ dateISO: '2026-11-10', sets: [{ exerciseId: 'cu_b', done: true }] }];
  assert.deepEqual(T.yourExercises(custom, logs).map(r => [r.ex.id, r.lastISO]), [['cu_b', '2026-11-10'], ['cu_a', null]]);
});

test('the picker opens on your machines, and replacing a movement leads with yours for it', () => {
  const db = accountWith(null);
  db.training.custom = custom.slice();
  db.training.logs = [{ id: 'l', dateISO: A.Store.todayISO(), sets: [{ exerciseId: 'cu_a', done: true, weightKg: 60, reps: 8 }] }];
  let picked = null;
  const ui = mount(A.ExercisePicker, { db, update() {}, onPick: (id) => { picked = id; }, onClose() {}, basedOn: 'machine_incline', title: 'Replace' });
  try {
    assert.ok(ui.has('Your machines for this'), ui.text.slice(0, 300));
    assert.ok(ui.text.indexOf('Your machines for this') < ui.text.indexOf('Hoist pec deck'), 'yours for this before the rest');
    assert.ok(ui.has('Hammer Strength · Used today'), 'brand and when it was last used, so two similar ones can be told apart');
    ui.clickEl(ui.findEl('Incline press'));
    assert.equal(picked, 'cu_a');
  } finally { ui.unmount(); }
});
