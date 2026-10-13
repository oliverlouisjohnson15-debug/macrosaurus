'use strict';
// "At this gym, when the plan says Machine fly, I use the Hoist one."
//
// The mapping lives on the gym and is applied when a session's rows are built. These tests hold the
// three promises that matter: the block is never edited, a mapping that points at something that no
// longer exists is ignored rather than followed, and a mapped row is exactly what a swap by hand
// would have made, so the way back to the plan's movement is still there.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

const custom = [{ id: 'cu_hoist', name: 'Hoist machine fly', equipment: 'machine', primary: ['ch'], pattern: 'isolation', profile: 'mid', custom: true, variantOf: 'machine_fly' }];
const gym = { id: 'g1', name: 'Bodybuilding gym', machines: { machine_fly: { use: 'cu_hoist' } } };
const row = (over) => Object.assign({
  id: 'i1', exerciseId: 'machine_fly', target: { sets: 2, repLow: 8, repHigh: 10, rir: 0 },
  planNote: 'Soft elbows.', alts: ['pec_deck'], warmups: 1, technique: 'drop',
}, over);

test('atGym answers the mapped movement, and the same one when there is nothing to map', () => {
  assert.strictEqual(T.atGym('machine_fly', gym, custom), 'cu_hoist');
  assert.strictEqual(T.atGym('pec_deck', gym, custom), 'pec_deck');
  assert.strictEqual(T.atGym('machine_fly', null, custom), 'machine_fly');
  assert.strictEqual(T.atGym('machine_fly', { machines: {} }, custom), 'machine_fly');
});

test('a mapping to something that does not exist is ignored, and a mapping is never followed twice', () => {
  assert.strictEqual(T.atGym('machine_fly', gym, []), 'machine_fly');
  const chain = { machines: { a: { use: 'b' }, machine_fly: { use: 'cu_hoist' }, cu_hoist: { use: 'pec_deck' } } };
  assert.strictEqual(T.atGym('machine_fly', chain, custom), 'cu_hoist');
  assert.strictEqual(T.atGym('machine_fly', { machines: { machine_fly: { use: 'machine_fly' } } }, custom), 'machine_fly');
});

test('applyGym makes what a swap by hand would make, keeps the prescription, and leaves the plan alone', () => {
  const plan = [row(), row({ id: 'i2', exerciseId: 'pec_deck' })];
  const before = JSON.stringify(plan);
  const out = T.applyGym(plan, gym, custom);
  assert.strictEqual(JSON.stringify(plan), before, 'the block row is untouched');
  assert.strictEqual(out[0].exerciseId, 'cu_hoist');
  assert.strictEqual(out[0].baseExerciseId, 'machine_fly', 'the way back is kept');
  assert.strictEqual(out[0].basePlanNote, 'Soft elbows.');
  assert.ok(!out[0].planNote, 'the author\'s note was about the other machine');
  assert.deepStrictEqual(out[0].target, plan[0].target);
  assert.strictEqual(out[0].technique, 'drop');
  assert.strictEqual(out[0].warmups, 1);
  assert.ok(out[0].gymMapped);
  assert.strictEqual(out[1], plan[1], 'an unmapped row is passed through as is');
});

test('with no gym applyGym returns the plan as written', () => {
  const plan = [row()];
  assert.strictEqual(T.applyGym(plan, null, custom)[0], plan[0]);
});

test('a mapped row answers a plan slot that offered it as a choice, as a question answered', () => {
  const choice = row({ choice: { options: ['cu_hoist'] } });
  const out = T.applyGym([choice], gym, custom)[0];
  assert.strictEqual(out.exerciseId, 'cu_hoist');
  assert.ok(!out.baseExerciseId, 'an open slot answered is not a stand-in');
});

// ---- the habit detector -----------------------------------------------------------------------

function history(n, usedId) {
  const blocks = [{ sessions: [{ id: 's1', exercises: [{ id: 'i1', exerciseId: 'machine_fly' }] }] }];
  const logs = [];
  for (let d = 1; d <= n; d++) {
    logs.push({ id: 'l' + d, dateISO: '2026-10-0' + d, sets: [
      { exerciseId: usedId, itemId: 'i1', setIndex: 0, done: true, weightKg: 40, reps: 8 },
      { exerciseId: usedId, itemId: 'i1', setIndex: 1, done: true, weightKg: 40, reps: 7 },
    ] });
  }
  return { blocks, logs };
}

test('the same swap in two sessions is offered, once, however many sets it was', () => {
  const { blocks, logs } = history(2, 'cu_hoist');
  const out = T.suggestGymMachines(logs, blocks, custom, { machines: {} });
  assert.deepStrictEqual(out, [{ from: 'machine_fly', to: 'cu_hoist', sessions: 2 }]);
});

test('one session is a busy machine, not a habit; a library movement is not offered; a known pair is not offered again', () => {
  assert.deepStrictEqual(T.suggestGymMachines(history(1, 'cu_hoist').logs, history(1, 'cu_hoist').blocks, custom, null), []);
  const h = history(3, 'pec_deck');
  assert.deepStrictEqual(T.suggestGymMachines(h.logs, h.blocks, custom, null), []);
  const k = history(3, 'cu_hoist');
  assert.deepStrictEqual(T.suggestGymMachines(k.logs, k.blocks, custom, gym), []);
});

test('a swap made for the rest of the block still counts, read against what the plan originally said', () => {
  // Somebody who answered "the rest of the block" has told us the habit as clearly as anyone; what the
  // gym can do for them is carry it past the end of the block.
  const k = history(2, 'cu_hoist');
  k.blocks[0].sessions[0].exercises[0] = { id: 'i1', exerciseId: 'cu_hoist', baseExerciseId: 'machine_fly' };
  const out = T.suggestGymMachines(k.logs, k.blocks, custom, null);
  assert.deepStrictEqual(out, [{ from: 'machine_fly', to: 'cu_hoist', sessions: 2 }]);
});

// ---- on screen ---------------------------------------------------------------------------------

const { app, mount, accountWith } = require('./helpers/app.js');
const A = app();

function accountAtGym() {
  const block = A.Training.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  const session = A.Training.weekSessions(block, 1)[0];
  const first = session.exercises.slice().sort((a, b) => a.order - b.order)[0].exerciseId;
  db.training.custom = [{ id: 'cu_mine', name: 'Hammer Strength Chest Press', equipment: 'machine', primary: ['ch'], pattern: 'horizPress', profile: 'mid', custom: true, variantOf: first }];
  db.training.gyms = [{ id: 'g1', name: 'Bodybuilding gym', type: 'commercial', machines: { [first]: { use: 'cu_mine' } } }];
  db.training.prefs.currentGymId = 'g1';
  return { block, db, session, first };
}

test('a session opens on the gym\'s own machine, and the block is left as written', () => {
  const { block, db, session, first } = accountAtGym();
  const before = JSON.stringify(block);
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {}, gym: db.training.gyms[0],
    sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    assert.ok(ui.has('Hammer Strength Chest Press'), 'the mapped machine is the movement: ' + ui.text.slice(0, 300));
    assert.strictEqual(JSON.stringify(db.training.blocks[0]), before, 'the block row still says ' + first);
  } finally { ui.unmount(); }
});

test('a session already under way is not re-mapped: the log says what was lifted', () => {
  const { block, db, session, first } = accountAtGym();
  db.training.logs = [{
    id: 'l1', dateISO: A.Store.todayISO(), blockId: block.id, sessionId: session.id, name: session.name,
    startedAt: new Date().toISOString(), endedAt: null,
    sets: [{ exerciseId: first, itemId: session.exercises[0].id, setIndex: 0, type: 'work', weightKg: 60, reps: 8, done: true }],
  }];
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {}, gym: db.training.gyms[0],
    sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    assert.ok(!ui.has('Hammer Strength Chest Press'), 'a resumed session keeps what was actually lifted');
  } finally { ui.unmount(); }
});

test('editing a gym\'s name keeps the machines it was taught', () => {
  const { db } = accountAtGym();
  const ui = mount(A.TrainSettings, { db, update(fn) { fn(db); }, showToast() {}, onBack() {}, onHowItWorks() {} });
  try {
    ui.click('Bodybuilding gym');
    assert.ok(ui.has('Machines here'), 'the editor lists what the gym was taught: ' + ui.text.slice(0, 200));
    ui.click('Save');
    assert.ok(db.training.gyms[0].machines, 'saving the gym did not wipe its machines');
    assert.strictEqual(Object.values(db.training.gyms[0].machines)[0].use, 'cu_mine');
  } finally { ui.unmount(); }
});

test('Train home offers to remember a swap made twice, once, and Yes writes it to the gym', () => {
  const { block, db, session, first } = accountAtGym();
  db.training.gyms[0].machines = {};
  const row = session.exercises.filter(e => e.exerciseId === first)[0];
  const mk = (id, d) => ({
    id, dateISO: d, blockId: block.id, sessionId: session.id, name: session.name, endedAt: d + 'T10:00:00Z',
    sets: [{ exerciseId: 'cu_mine', itemId: row.id, setIndex: 0, type: 'work', weightKg: 60, reps: 8, done: true }],
  });
  db.training.logs = [mk('a', '2026-09-01'), mk('b', '2026-09-08')];
  const ui = mount(A.TrainTab, { db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {} });
  try {
    assert.ok(ui.has('Remember that for Bodybuilding gym?'), ui.text.slice(0, 400));
    ui.click('Yes, remember');
    assert.strictEqual(db.training.gyms[0].machines[first].use, 'cu_mine');
    assert.ok(db.training.prefs.sawGymSeed, 'and it does not ask again');
  } finally { ui.unmount(); }
});
