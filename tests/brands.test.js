'use strict';
// A machine's maker is a label, not a different movement.
//
// Every name below is one that was actually typed into a real account at a real gym. Before the
// maker was split off, a handful resolved to nothing, one machine was saved three times, and the
// history of each copy was too short to say anything.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

const nameOf = (n, custom) => { const r = T.resolveDetail(n, custom); return r ? (T.byId(r.id, custom) || {}).name : null; };

test('the maker is split off the front, the back, or a trailing bracket', () => {
  assert.deepStrictEqual(T.splitBrand('Hammer Strength Incline Press'), { brand: 'Hammer Strength', rest: 'incline press' });
  assert.deepStrictEqual(T.splitBrand('Incline Hammer Strength Press'), { brand: 'Hammer Strength', rest: 'incline press' });
  assert.deepStrictEqual(T.splitBrand('Pec deck (Hoist)'), { brand: 'Hoist', rest: 'pec deck' });
  assert.deepStrictEqual(T.splitBrand('Hammer Strength Iso-Lateral Incline Press'), { brand: 'Hammer Strength', rest: 'incline press' });
  assert.deepStrictEqual(T.splitBrand('Life fitness tricep extension').brand, 'Life Fitness');
});

test('a movement word that is also a maker\'s first word is left alone', () => {
  assert.strictEqual(T.splitBrand('Hammer curl').brand, null);
  assert.strictEqual(T.splitBrand('Prime').brand, 'Prime');
  assert.strictEqual(T.splitBrand('Cable curl with a prime grip').brand, null, 'a single-word maker mid-name is a movement word');
  assert.strictEqual(nameOf('Hammer curl'), 'Hammer curl');
});

test('names the matcher used to drop now resolve to a movement', () => {
  for (const n of ['Hammer Strength Incline Press', 'Incline Hammer Strength Press', 'Hammer Strength Shoulder Press',
    'Hammer Strength tricep extension', 'Prime Leg Curl', 'Atlantis Seated Row', 'Life fitness tricep extension',
    'Nautilus pullover', 'Hoist Pec Deck', 'Pit Shark RDL', 'Technogym chest press']) {
    assert.ok(T.resolveDetail(n), n + ' should resolve');
  }
  assert.strictEqual(nameOf('Hammer Strength Incline Press'), 'Incline machine press');
  assert.strictEqual(nameOf('Hoist Pec Deck'), 'Pec deck');
  assert.strictEqual(nameOf('Pit Shark RDL'), 'Romanian deadlift');
});

test('a custom movement that carries the maker in its name still matches itself exactly', () => {
  const custom = [{ id: 'cu_1', name: 'Hammer Strength Incline Press', equipment: 'machine', primary: ['ch'], pattern: 'horizPress', custom: true }];
  assert.strictEqual(T.resolveDetail('Hammer Strength Incline Press', custom).id, 'cu_1');
  assert.strictEqual(T.resolveDetail('Hammer Strength Incline Press', custom).how, 'exact');
});

test('a coach\'s tag in front of an imported name is not part of the name', () => {
  assert.strictEqual(T.tidyName ? T.tidyName('M1: standing dumbbell curl') : 'Standing dumbbell curl', 'Standing dumbbell curl');
});

// ---- twins --------------------------------------------------------------------------------------

const owned = [
  { id: 'a', name: 'Hammer Strength Incline Press', variantOf: 'machine_incline', custom: true },
  { id: 'b', name: 'Incline Hammer Strength Press', variantOf: 'smith_machine_incline_press', custom: true },
  { id: 'c', name: 'Hoist Pec Deck', variantOf: 'pec_deck', custom: true },
];

test('the same words in another order is the same machine', () => {
  assert.strictEqual(T.findDuplicate({ name: 'Incline Hammer Strength Press' }, owned).id, 'a');
  assert.strictEqual(T.findDuplicate({ name: 'Pec Deck (Hoist)' }, owned).id, 'c');
});

test('the same maker\'s version of the same movement is the same machine, even under another name', () => {
  assert.strictEqual(T.findDuplicate({ name: 'Hoist pec-deck fly', variantOf: 'pec_deck', brand: 'Hoist' }, owned).id, 'c');
});

test('a different maker\'s version is not a twin, and nor is a movement with no maker', () => {
  assert.strictEqual(T.findDuplicate({ name: 'Life Fitness Pec Deck', variantOf: 'pec_deck', brand: 'Life Fitness' }, owned), null);
  assert.strictEqual(T.findDuplicate({ name: 'Pec Deck', variantOf: 'pec_deck' }, owned), null);
  assert.strictEqual(T.findDuplicate({ name: '' }, owned), null);
});

test('editing a movement never reports it as its own twin', () => {
  assert.strictEqual(T.findDuplicate({ id: 'a', name: 'Hammer Strength Incline Press' }, [owned[0]]), null);
});

test('inferPattern: one muscle is isolation, two are a compound, the trunk is core', () => {
  assert.strictEqual(T.inferPattern(['bi']), 'isolation');
  assert.strictEqual(T.inferPattern(['ub', 'lt']), 'compound');
  assert.strictEqual(T.inferPattern(['ab']), 'core');
  assert.strictEqual(T.inferPattern([]), 'isolation');
});

// ---- merging ------------------------------------------------------------------------------------

function account() {
  return {
    custom: [
      { id: 'a', name: 'Hammer Strength Incline Press', equipment: 'machine', primary: ['ch'], custom: true },
      { id: 'b', name: 'Incline Hammer Strength Press', equipment: 'machine', primary: ['ch'], custom: true, brand: 'Hammer Strength', load: { unit: 'lb', step: 10 } },
      { id: 'v', name: 'Wide incline', equipment: 'machine', primary: ['ch'], custom: true, variantOf: 'b' },
    ],
    logs: [
      { id: 'l1', dateISO: '2026-09-01', exerciseNotes: { b: 'seat 3' }, sets: [{ exerciseId: 'a', weightKg: 50, reps: 8, done: true }] },
      { id: 'l2', dateISO: '2026-09-08', exerciseNotes: { a: 'seat 4', b: 'seat 3' }, sets: [{ exerciseId: 'b', weightKg: 55, reps: 8, done: true }, { exerciseId: 'b', weightKg: 55, reps: 7, done: true }] },
    ],
    blocks: [{ sessions: [{ exercises: [{ id: 'r', exerciseId: 'b', baseExerciseId: 'machine_incline', alts: ['b', 'pec_deck'] }] }] }],
    gyms: [{ id: 'g', machines: { machine_incline: { use: 'b' }, b: { load: { unit: 'lb', step: 10 } } } }],
    prefs: { dislikes: ['b'], machineLoads: {} },
    rotations: [{ from: 'x', to: 'b' }],
  };
}

test('merging moves every set, row, note and gym setting, and deletes the copy', () => {
  const tr = account();
  const moved = T.mergeExercise(tr, 'b', 'a');
  assert.deepStrictEqual(moved, { sets: 2, rows: 1 });
  assert.ok(tr.logs.every(l => l.sets.every(s => s.exerciseId === 'a')));
  assert.strictEqual(tr.logs[0].exerciseNotes.a, 'seat 3');
  assert.strictEqual(tr.logs[1].exerciseNotes.a, 'seat 4', 'a note already on the survivor is not overwritten');
  assert.ok(!('b' in tr.logs[1].exerciseNotes));
  const row = tr.blocks[0].sessions[0].exercises[0];
  assert.strictEqual(row.exerciseId, 'a');
  assert.deepStrictEqual(row.alts, ['a', 'pec_deck']);
  assert.ok(!tr.custom.some(x => x.id === 'b'));
  assert.strictEqual(tr.custom.find(x => x.id === 'v').variantOf, 'a');
  assert.strictEqual(tr.custom.find(x => x.id === 'a').brand, 'Hammer Strength', 'the survivor keeps what the copy knew');
  assert.deepStrictEqual(tr.custom.find(x => x.id === 'a').load, { unit: 'lb', step: 10 });
  assert.strictEqual(tr.gyms[0].machines.machine_incline.use, 'a');
  assert.deepStrictEqual(tr.gyms[0].machines.a.load, { unit: 'lb', step: 10 });
  assert.ok(!tr.gyms[0].machines.b);
  assert.deepStrictEqual(tr.prefs.dislikes, ['a']);
  assert.strictEqual(tr.rotations[0].to, 'a');
});

test('after a merge the two sessions are one history', () => {
  const tr = account();
  T.mergeExercise(tr, 'b', 'a');
  assert.strictEqual(T.exerciseHistory(tr.logs, 'a').length, 2);
});

test('only a custom movement can be folded away, into something that exists, and never into itself', () => {
  assert.strictEqual(T.mergeExercise(account(), 'pec_deck', 'a'), null);
  assert.strictEqual(T.mergeExercise(account(), 'b', 'nope'), null);
  assert.strictEqual(T.mergeExercise(account(), 'b', 'b'), null);
});

// ---- on screen ----------------------------------------------------------------------------------

const { app, mount, accountWith } = require('./helpers/app.js');
const A = app();

function twice() {
  const db = accountWith();
  db.training.custom = [
    { id: 'cu_a', name: 'Hammer Strength Incline Press', equipment: 'machine', primary: ['ch'], pattern: 'horizPress', profile: 'mid', custom: true, variantOf: 'machine_incline' },
    { id: 'cu_b', name: 'Incline Hammer Strength Press', equipment: 'machine', primary: ['ch'], pattern: 'horizPress', profile: 'mid', custom: true, variantOf: 'machine_incline' },
  ];
  db.training.logs = [
    { id: 'l1', dateISO: '2026-09-01', name: 'x', sets: [{ exerciseId: 'cu_a', weightKg: 80, reps: 8, done: true }, { exerciseId: 'cu_a', weightKg: 80, reps: 7, done: true }] },
    { id: 'l2', dateISO: '2026-09-08', name: 'x', sets: [{ exerciseId: 'cu_b', weightKg: 85, reps: 8, done: true }] },
  ];
  return db;
}

test('saving a movement you already have asks first, and Use it adds nothing', () => {
  const db = twice();
  let done = null;
  const ui = mount(A.CustomExercise, { db, update(fn) { fn(db); }, initialName: 'Incline Hammer Strength Press', basedOn: null, onDone(id) { done = id; }, onClose() {} });
  try {
    ui.click('Chest');
    ui.click('Save');
    assert.ok(ui.has('You already have'), ui.text.slice(0, 300));
    assert.strictEqual(db.training.custom.length, 2, 'nothing saved yet');
    ui.click('Use it');
    assert.strictEqual(done, 'cu_a');
    assert.strictEqual(db.training.custom.length, 2);
  } finally { ui.unmount(); }
});

test('Save as new does save it, with the maker and an inferred pattern', () => {
  const db = twice();
  const ui = mount(A.CustomExercise, { db, update(fn) { fn(db); }, initialName: 'Hammer Strength Incline Press', basedOn: null, onDone() {}, onClose() {} });
  try {
    ui.click('Chest');
    ui.click('Save');
    ui.click('Save as new');
    const made = db.training.custom[db.training.custom.length - 1];
    assert.strictEqual(made.brand, 'Hammer Strength');
    assert.strictEqual(made.pattern, 'isolation', 'one muscle and no parent is isolation');
    assert.strictEqual(db.training.custom.length, 3);
  } finally { ui.unmount(); }
});

test('the maker is filled in from the name as it is typed, until the person says otherwise', () => {
  const db = twice();
  const ui = mount(A.CustomExercise, { db, update(fn) { fn(db); }, initialName: '', basedOn: null, onDone() {}, onClose() {} });
  try {
    const inputs = () => Array.from(ui.host.querySelectorAll('input[type="text"]'));
    ui.type(inputs()[0], 'Hoist machine fly');
    assert.strictEqual(inputs()[1].value, 'Hoist');
    ui.type(inputs()[1], 'My own');
    ui.type(inputs()[0], 'Prime leg curl');
    assert.strictEqual(inputs()[1].value, 'My own', 'a maker the person typed is not overwritten');
  } finally { ui.unmount(); }
});

test('Merge into… moves the sets across, deletes the copy and tombstones it', () => {
  const db = twice();
  const ui = mount(A.ExerciseDetail, { db, update(fn) { fn(db); }, showToast() {}, exerciseId: 'cu_b', onBack() {}, onMerged() {} });
  try {
    ui.click('Merge into another movement');
    ui.click('Hammer Strength Incline Press');
    assert.ok(ui.has('cannot be undone'), ui.text.slice(0, 300));
    ui.click('Merge');
  } finally { ui.unmount(); }
  assert.ok(db.training.logs.every(l => l.sets.every(s => s.exerciseId === 'cu_a')));
  assert.deepStrictEqual(db.training.custom.map(c => c.id), ['cu_a']);
  assert.ok(db.deleted && db.deleted.cu_b, 'tombstoned so a sync cannot put it back');
});

test('History says when a machine has been saved twice, and the merge keeps the longer history', () => {
  const db = twice();
  const ui = mount(A.TrainHistory, { db, update(fn) { fn(db); }, onBack() {}, onOpenExercise() {}, onOpenSession() {}, onTab() {} });
  try {
    assert.ok(ui.has('1 machine looks saved twice'), ui.text.slice(0, 300));
    ui.click('saved twice');
    ui.click('Merge into Hammer Strength Incline Press');
  } finally { ui.unmount(); }
  assert.deepStrictEqual(db.training.custom.map(c => c.id), ['cu_a'], 'the one with two sets survives');
});
