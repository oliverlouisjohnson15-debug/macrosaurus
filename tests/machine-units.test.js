'use strict';
// What a machine shows: kilograms, pounds, a pin number, or plates on a side.
//
// Sets keep `weightKg` whatever the machine says, so everything older still reads. What these tests
// pin down is the other half: that the step a movement progresses by is the step THAT machine can
// make, that a pin number is never mistaken for a mass, and that with no spec at all every number
// is the number the app has always produced.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

const lat = T.byId('lat_pulldown');
const target = { sets: 2, repLow: 8, repHigh: 10, rir: 0 };
const done = (w, r) => [{ done: true, weightKg: w, reps: r }];

test('with no spec, resolution is flagged as the default and the steps are unchanged', () => {
  const spec = T.loadSpecFor('lat_pulldown', { prefs: { units: 'kg' } });
  assert.strictEqual(spec.explicit, false);
  assert.strictEqual(T.loadUnit(lat, spec), 2.5);
  const a = T.progressExercise(target, done(60, 10), lat, { style: 'minmax' });
  const b = T.progressExercise(target, done(60, 10), lat, { style: 'minmax', spec });
  assert.strictEqual(a.weightKg, b.weightKg);
  assert.strictEqual(a.weightKg, 62.5);
});

test('lb users with no spec still get the old kilogram steps', () => {
  const spec = T.loadSpecFor('lat_pulldown', { prefs: { units: 'lb' } });
  assert.strictEqual(spec.unit, 'lb');
  assert.strictEqual(spec.explicit, false);
  assert.strictEqual(T.loadUnit(lat, spec), 2.5);
});

test('resolution order: gym machine, then personal default, then custom exercise', () => {
  const custom = [{ id: 'cu_x', name: 'Hoist fly', equipment: 'machine', primary: ['ch'], load: { unit: 'lb', step: 5 } }];
  const gym = { machines: { cu_x: { load: { unit: 'pin', step: 1 } } } };
  assert.strictEqual(T.loadSpecFor('cu_x', { custom, gym }).unit, 'pin');
  assert.strictEqual(T.loadSpecFor('cu_x', { custom, gym: {}, prefs: { machineLoads: { cu_x: { unit: 'kg', step: 1.25 } } } }).step, 1.25);
  assert.strictEqual(T.loadSpecFor('cu_x', { custom }).unit, 'lb');
  assert.strictEqual(T.loadSpecFor('cu_x', { custom }).explicit, true);
});

test('an lb stack with 10 lb jumps goes up by 10 lb, not 2.5 kg', () => {
  const spec = { unit: 'lb', step: 10, perSide: false, explicit: true };
  const kg = T.fromMachine(80, spec);
  const next = T.progressExercise(target, done(kg, 10), lat, { style: 'minmax', spec });
  assert.strictEqual(T.toMachine(next.weightKg, spec), 90);
});

test('a pin machine goes up one pin', () => {
  const spec = { unit: 'pin', step: 1, perSide: false, explicit: true };
  const next = T.progressExercise(target, done(4, 10), lat, { style: 'minmax', spec });
  assert.strictEqual(next.weightKg, 5);
  assert.strictEqual(T.toMachine(5, spec), 5);
  assert.strictEqual(T.fromMachine(5, spec), 5);
});

test('plates on a side: you type one side, the total is stored, a step is one plate each side', () => {
  const spec = { unit: 'kg', step: 2.5, perSide: true, explicit: true };
  assert.strictEqual(T.fromMachine(30, spec), 60);
  assert.strictEqual(T.toMachine(60, spec), 30);
  assert.strictEqual(T.loadUnit(lat, spec), 5);
  const next = T.progressExercise(target, done(60, 10), lat, { style: 'minmax', spec });
  assert.strictEqual(next.weightKg, 65);
});

test('under the floor, ten percent off lands on the machine\'s own grid', () => {
  const spec = { unit: 'lb', step: 10, perSide: false, explicit: true };
  const kg = T.fromMachine(100, spec);
  const next = T.progressExercise(target, done(kg, 5), lat, { style: 'minmax', spec });
  assert.strictEqual(next.action, 'lighter');
  assert.strictEqual(T.toMachine(next.weightKg, spec) % 10, 0);
});

test('the back-off set rounds to the machine\'s grid as well', () => {
  const spec = { unit: 'lb', step: 10, perSide: false, explicit: true };
  const top = T.fromMachine(100, spec);
  assert.strictEqual(T.toMachine(T.backOffLoad(top, lat, spec), spec) % 10, 0);
});

test('a pin set adds nothing to tonnage and nothing to the strength stats', () => {
  assert.strictEqual(T.tonnage({ sets: [{ done: true, weightKg: 4, reps: 10, unit: 'pin' }] }), 0);
  assert.strictEqual(T.tonnage({ sets: [{ done: true, weightKg: 4, reps: 10 }] }), 40);
  const logs = [{ id: 'a', dateISO: '2026-10-01', sets: [{ exerciseId: 'lat_pulldown', done: true, weightKg: 20, reps: 10, unit: 'pin' }] }];
  const sheet = T.statSheet(logs, { bodyweightKg: 80 });
  assert.strictEqual(sheet.bestLiftKg, 0);
});

test('guessLoadUnit offers lb for pound-shaped numbers and pin for small whole numbers, and is quiet otherwise', () => {
  const mk = (id, ws) => [{ id: 'l', dateISO: '2026-10-01', sets: ws.map(w => ({ exerciseId: id, done: true, weightKg: w, reps: 8 })) }];
  assert.strictEqual(T.guessLoadUnit(mk('lat_pulldown', [29.3, 36.3, 41]), 'lat_pulldown'), 'lb');
  assert.strictEqual(T.guessLoadUnit(mk('machine_preacher', [3, 4, 4, 5]), 'machine_preacher'), 'pin');
  assert.strictEqual(T.guessLoadUnit(mk('lat_pulldown', [60, 62.5, 65]), 'lat_pulldown'), null);
  assert.strictEqual(T.guessLoadUnit(mk('lat_pulldown', [60]), 'lat_pulldown'), null);
});

test('relabelLoads converts pounds typed as kilograms, marks pins, and only from the date given', () => {
  const logs = () => [
    { id: 'a', dateISO: '2026-09-01', sets: [{ exerciseId: 'x', weightKg: 65, reps: 8 }] },
    { id: 'b', dateISO: '2026-10-01', sets: [{ exerciseId: 'x', weightKg: 65, reps: 8 }, { exerciseId: 'y', weightKg: 65, reps: 8 }] },
  ];
  const l = logs();
  assert.strictEqual(T.relabelLoads(l, 'x', 'lb', { fromISO: '2026-09-15' }), 1);
  assert.strictEqual(l[0].sets[0].weightKg, 65);
  assert.strictEqual(l[1].sets[0].weightKg, 29.48);
  assert.strictEqual(l[1].sets[1].weightKg, 65);
  const p = logs();
  assert.strictEqual(T.relabelLoads(p, 'x', 'pin'), 2);
  assert.strictEqual(p[0].sets[0].unit, 'pin');
});

// ---- the session screen --------------------------------------------------------------------------

const { app, mount, accountWith } = require('./helpers/app.js');
const A = app();

function openSession(machines) {
  const block = A.Training.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  const session = A.Training.weekSessions(block, 1)[0];
  const first = session.exercises.slice().sort((a, b) => a.order - b.order)[0].exerciseId;
  const gym = { id: 'g1', name: 'Bodybuilding gym', type: 'commercial', machines: machines ? { [first]: { load: machines } } : {} };
  db.training.gyms = [gym];
  db.training.prefs.currentGymId = 'g1';
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {}, gym,
    sessionId: session.id, blockId: block.id, onExit() {},
  });
  return { ui, db, first, gym };
}

test('a pin machine heads its weight column PIN and files its sets as pins', () => {
  const { ui, db, first } = openSession({ unit: 'pin', step: 1 });
  try {
    assert.ok(/Set\s*pin\s*Reps/i.test(ui.text), 'the column is headed by what the machine shows: ' + ui.text.slice(0, 300));
    const box = ui.host.querySelector('input[inputmode="decimal"]');
    ui.type(box, 4);
    ui.clickEl(ui.host.querySelector('button[aria-label="Mark set 1 done"]'));
    const sets = db.training.logs[0].sets.filter(s => s.exerciseId === first);
    assert.ok(sets.length && sets.every(s => s.unit === 'pin'), 'sets on a pin machine are tagged: ' + JSON.stringify(sets));
    assert.strictEqual(sets[0].weightKg, 4);
  } finally { ui.unmount(); }
});

test('Machine units saves a spec for this machine at this gym', () => {
  const { ui, db, first, gym } = openSession(null);
  try {
    // The session has a More of its own; the movement's is the last one on the screen.
    const mores = Array.from(ui.host.querySelectorAll('button')).filter(b => b.textContent.trim() === 'More');
    ui.clickEl(mores[mores.length - 1]);
    ui.click('Machine units');
    assert.ok(ui.has('Plates, one side at a time'));
    ui.click('lb');
    ui.click('Save');
    const saved = db.training.gyms[0].machines[first].load;
    assert.strictEqual(saved.unit, 'lb');
    assert.ok(saved.step > 0);
  } finally { ui.unmount(); }
});
