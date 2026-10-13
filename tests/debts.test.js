'use strict';
// Debts written down in TRAIN_AUDIT.md and paid off here.
const { test } = require('node:test');
const assert = require('node:assert');
const Store = require('../app/store.js');
const { app, mount, accountWith, React } = require('./helpers/app.js');

const A = app();

// ---- two devices adding a set at the same moment -----------------------------------------------

const log = (sets, extra) => Object.assign({ id: 'L', dateISO: '2026-10-01', sets }, extra);
const set = (over) => Object.assign({ exerciseId: 'x', itemId: 'i1', type: 'work', weightKg: 60, reps: 8, done: true }, over);
const merge = (a, b) => Store.mergeStates({ _rev: 200, training: { logs: [a] } }, { _rev: 100, training: { logs: [b] } }).training.logs[0];

test('two devices that each add a set at the same position keep both', () => {
  const phone = log([set({ setIndex: 0, id: 's_a' }), set({ setIndex: 1, id: 's_b', reps: 7 })]);
  const laptop = log([set({ setIndex: 0, id: 's_a' }), set({ setIndex: 1, id: 's_c', reps: 6 })]);
  const m = merge(phone, laptop);
  assert.deepStrictEqual(m.sets.map(s => s.id).sort(), ['s_a', 's_b', 's_c']);
});

test('the same set seen from both devices is one set, and the newer copy of it wins', () => {
  const phone = log([set({ setIndex: 0, id: 's_a', reps: 9 })]);
  const laptop = log([set({ setIndex: 0, id: 's_a', reps: 8 })]);
  const m = merge(phone, laptop);
  assert.strictEqual(m.sets.length, 1);
  assert.strictEqual(m.sets[0].reps, 9);
});

test('a set from before ids existed is not doubled by the same set written with one', () => {
  const old = log([set({ setIndex: 0 }), set({ setIndex: 1 })]);
  const newer = log([set({ setIndex: 0, id: 's_a' }), set({ setIndex: 1, id: 's_b' })]);
  assert.strictEqual(merge(newer, old).sets.length, 2);
  assert.strictEqual(merge(old, newer).sets.length, 2);
});

test('old logs merge exactly as they always did', () => {
  const a = log([set({ setIndex: 0 }), set({ setIndex: 1 })]);
  const b = log([set({ setIndex: 0 }), set({ setIndex: 2 })]);
  assert.deepStrictEqual(merge(a, b).sets.map(s => s.setIndex).sort(), [0, 1, 2]);
});

test('the session gives every set it creates an id, and leaves a resumed old set without one', () => {
  const block = A.Training.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  const session = A.Training.weekSessions(block, 1)[0];
  const first = session.exercises.slice().sort((a, b) => a.order - b.order)[0];
  db.training.logs = [{
    id: 'old', dateISO: A.Store.todayISO(), blockId: block.id, sessionId: session.id, name: session.name,
    startedAt: new Date().toISOString(), endedAt: null,
    sets: [{ exerciseId: first.exerciseId, itemId: first.id, setIndex: 0, type: 'work', weightKg: 60, reps: 8, done: true }],
  }];
  const ui = mount(A.SessionPlayer, { db, update(fn) { fn(db); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {} });
  try {
    ui.click('Add set');
    const sets = db.training.logs[0].sets.filter(s => s.itemId === first.id);
    assert.ok(sets.length >= 2);
    assert.ok(!sets[0].id, 'the set that was already logged stays as it was');
    assert.ok(sets[sets.length - 1].id, 'the one just added has an id');
  } finally { ui.unmount(); }
});

// ---- the settings screen reads the account, not a copy of it ------------------------------------

test('Training settings follow a preference changed elsewhere while the screen is open', () => {
  const db = accountWith();
  const bump = {};
  function Harness() {
    const [, setN] = React.useState(0);
    bump.fn = () => setN(n => n + 1);
    return React.createElement(A.TrainSettings, { db, update(fn) { fn(db); }, showToast() {}, onBack() {}, onHowItWorks() {} });
  }
  const ui = mount(Harness, {});
  try {
    const restOn = () => {
      const onOff = Array.from(ui.host.querySelectorAll('[role="radiogroup"]'))
        .find(g => Array.from(g.querySelectorAll('button')).map(b => b.textContent.trim()).join() === 'On,Off');
      return onOff.querySelector('[aria-checked="true"]').textContent.trim();
    };
    assert.strictEqual(restOn(), 'On');
    db.training.prefs.restTimer = false;          // written by something else, say another tab
    React.act(() => { bump.fn(); });
    assert.strictEqual(restOn(), 'Off', 'the screen shows what is true now');
  } finally { ui.unmount(); }
});
