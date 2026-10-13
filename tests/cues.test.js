'use strict';
// How to do it, and how this machine is set up for you.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();

test('every movement in a shipped programme has a cue, or is on the list of those that deliberately do not', () => {
  const ids = new Set();
  T.PROGRAMMES.forEach(p => p.template.forEach(d => d.exercises.forEach(e => ids.add(e.exerciseId))));
  const uncovered = [...ids].filter(id => !T.cueSource(T.byId(id)) && T.NO_CUE.indexOf(id) === -1);
  assert.deepStrictEqual(uncovered, [], 'a new programme line needs a cue, or a place on NO_CUE');
});

test('NO_CUE only lists movements that really have none, so it cannot hide a gap', () => {
  T.NO_CUE.forEach(id => {
    assert.ok(T.byId(id), id + ' exists');
    assert.ok(!T.cueSource(T.byId(id)), id + ' has a cue, so it does not belong on the list');
  });
});

test('a cue is a sentence or two, not a paragraph', () => {
  const ids = new Set();
  T.PROGRAMMES.forEach(p => p.template.forEach(d => d.exercises.forEach(e => ids.add(e.exerciseId))));
  [...ids].forEach(id => {
    const c = T.cueSource(T.byId(id));
    if (!c) return;
    assert.ok(c.text.length <= 220, id + ': ' + c.text.length + ' characters');
    assert.ok(/[.!]$/.test(c.text), id + ' ends like a sentence');
  });
});

test('a variation borrows its parent\'s cue and says whose it is; a movement with its own keeps it', () => {
  const wide = T.cueSource(T.byId('pullup__wide'));
  assert.strictEqual(wide.from, 'Pull-up');
  assert.ok(wide.text.length > 0);
  assert.strictEqual(T.cueSource(T.byId('pec_deck')).from, null);
  const custom = [{ id: 'cu_h', name: 'Hoist Pec Deck', variantOf: 'pec_deck', equipment: 'machine', primary: ['ch'], custom: true }];
  assert.strictEqual(T.cueSource(T.byId('cu_h', custom), custom).from, 'Pec deck');
  assert.strictEqual(T.cueSource(T.byId('cu_nobody', [{ id: 'cu_nobody', name: 'X', primary: ['ch'], custom: true }]), []), null);
});

// ---- machine setup ------------------------------------------------------------------------------

test('a setup note resolves per machine at the gym, then on the movement, then for the library movement', () => {
  const custom = [{ id: 'cu_a', name: 'A', primary: ['ch'], custom: true, setup: 'on the movement' }];
  const gym = { machines: { cu_a: { setup: 'at the gym' } } };
  assert.strictEqual(T.setupFor('cu_a', { gym, custom }), 'at the gym');
  assert.strictEqual(T.setupFor('cu_a', { gym: { machines: {} }, custom }), 'on the movement');
  assert.strictEqual(T.setupFor('pec_deck', { prefs: { machineSetup: { pec_deck: 'seat 3' } } }), 'seat 3');
  assert.strictEqual(T.setupFor('pec_deck', {}), '');
});

function openAt(setup) {
  const block = A.Training.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  const session = A.Training.weekSessions(block, 1)[0];
  const first = session.exercises.slice().sort((a, b) => a.order - b.order)[0].exerciseId;
  const gym = { id: 'g1', name: 'Bodybuilding gym', type: 'commercial', machines: setup ? { [first]: { setup } } : {} };
  db.training.gyms = [gym];
  db.training.prefs.currentGymId = 'g1';
  const ui = mount(A.SessionPlayer, { db, update(fn) { fn(db); }, showToast() {}, gym, sessionId: session.id, blockId: block.id, onExit() {} });
  return { ui, db, first };
}

test('the setup shows above the first set, and goes once a set is ticked', () => {
  const { ui } = openAt('Seat 4, back pad 2');
  try {
    assert.ok(ui.has('Setup: Seat 4, back pad 2'), ui.text.slice(0, 500));
    ui.clickEl(ui.host.querySelector('button[aria-label="Mark set 1 done"]'));
    assert.ok(!ui.has('Setup: Seat 4'), 'out of the way once you are under the weight');
  } finally { ui.unmount(); }
});

test('Machine setup saves a note for this machine at this gym', () => {
  const { ui, db, first } = openAt(null);
  try {
    const mores = Array.from(ui.host.querySelectorAll('button')).filter(b => b.textContent.trim() === 'More');
    ui.clickEl(mores[mores.length - 1]);
    ui.click('Machine setup');
    const box = Array.from(ui.doc.querySelectorAll('input[type="text"]')).pop();
    ui.type(box, 'Seat 3, handles wide');
    ui.click('Save');
    assert.strictEqual(db.training.gyms[0].machines[first].setup, 'Seat 3, handles wide');
    assert.ok(ui.has('Setup: Seat 3, handles wide'));
  } finally { ui.unmount(); }
});
