'use strict';
// Bringing your history from another app.
//
// The three fixtures in tests/fixtures/history are written to the layouts those apps document for
// their CSV exports (Strong's `Exercise Name` / `Set Order` file, Hevy's `exercise_title` / `set_type`
// file, FitNotes' `Weight (kgs)` file) with invented data. They were NOT taken from a real account, so
// when a real export turns up, the first thing to do is run it through this and look at what it says.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../app/training.js');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'history', n), 'utf8');

test('the parser handles quotes, commas inside quotes, CRLF and a byte-order mark', () => {
  const rows = T.parseCsv('﻿a,b\r\n"x, y",2\r\n"say ""hi""",3\r\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['x, y', '2'], ['say "hi"', '3']]);
});

test('Strong: recognised, grouped into sessions, and the units are asked for rather than guessed', () => {
  const r = T.historyFromCsv(fx('strong.csv'), {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.format, 'Strong');
  assert.strictEqual(r.sessions, 2, 'a run is not a lifting session');
  assert.strictEqual(r.needsUnits, true, 'a Strong export does not say kg or lb');
  assert.deepStrictEqual(r.logs, [], 'nothing is built until the unit is known');
  assert.strictEqual(r.skipped.cardio, 1);
  assert.strictEqual(r.from, '2026-09-01');
  assert.strictEqual(r.to, '2026-09-04');
});

test('Strong: sets, set types, RPE and the placed names', () => {
  const r = T.historyFromCsv(fx('strong.csv'), { units: 'kg' });
  assert.strictEqual(r.needsUnits, false);
  const push = r.logs.find(l => l.name === 'Push A');
  assert.ok(push, 'the push day');
  assert.strictEqual(push.dateISO, '2026-09-01');
  assert.strictEqual(push.notes, 'Felt strong');
  const bench = push.sets.filter(s => s.exerciseId === 'bb_bench');
  assert.deepStrictEqual(bench.map(s => s.type), ['warmup', 'work', 'work']);
  assert.deepStrictEqual(bench.map(s => s.weightKg), [40, 60, 60]);
  assert.deepStrictEqual(bench.map(s => s.setIndex), [0, 1, 2]);
  assert.strictEqual(bench[1].rir, 1, 'RPE 9 is one in reserve');
  assert.strictEqual(bench[2].rir, 0.5);
  assert.ok(push.sets.every(s => s.done === true));
  assert.ok(!push.sets.some(s => /rest/i.test(String(s.exerciseId))), 'rest timer rows are not sets');
});

test('Strong: a quoted workout name with a comma stays one name, and a bodyweight set keeps its reps', () => {
  const r = T.historyFromCsv(fx('strong.csv'), { units: 'kg' });
  const pull = r.logs.find(l => l.name === 'Pull, heavy');
  assert.ok(pull);
  const chin = pull.sets.find(s => s.exerciseId === 'pullup');
  assert.deepStrictEqual([chin.weightKg, chin.reps], [0, 8]);
});

test('names are placed with care: a clean match is taken, a missing one is listed, a near one is offered', () => {
  const r = T.historyFromCsv(fx('strong.csv'), { units: 'kg' });
  const by = (n) => r.names.find(x => x.name === n);
  assert.strictEqual(by('Bench Press (Barbell)').id, 'bb_bench');
  assert.strictEqual(by('Incline Bench Press (Dumbbell)').how, 'strong');
  assert.strictEqual(T.byId(by('Incline Bench Press (Dumbbell)').id).name, 'Incline dumbbell press', 'incline is not lost');
  assert.strictEqual(by('Wobble Thing Of Mystery').id, null);
  assert.ok(r.unplaced.some(p => p.name === 'Wobble Thing Of Mystery'));
});

test('a brand-named machine from another app is placed through its maker', () => {
  const r = T.historyFromCsv(fx('strong.csv'), { units: 'kg' });
  const hs = r.names.find(x => x.name === 'Hammer Strength Incline Press');
  assert.ok(hs.id, 'placed');
  assert.strictEqual(T.byId(hs.id).name, 'Incline machine press');
});

test('choices made by the person are applied, and skipping a name drops only its sets', () => {
  const r = T.historyFromCsv(fx('strong.csv'), { units: 'kg', map: { 'Wobble Thing Of Mystery': 'lat_pulldown', 'Hammer Strength Incline Press': null } });
  const push = r.logs.find(l => l.name === 'Push A');
  assert.ok(push.sets.some(s => s.exerciseId === 'lat_pulldown' && s.weightKg === 10));
  assert.ok(!push.sets.some(s => s.weightKg === 50), 'the skipped machine left no sets');
});

test('Hevy: pounds from the column name, set types, and the date from a long-form timestamp', () => {
  const r = T.historyFromCsv(fx('hevy.csv'), {});
  assert.strictEqual(r.format, 'Hevy');
  assert.strictEqual(r.unit, 'lb');
  assert.strictEqual(r.needsUnits, false);
  assert.strictEqual(r.sessions, 1);
  const log = r.logs[0];
  assert.strictEqual(log.dateISO, '2026-09-07');
  const squat = log.sets.filter(s => s.exerciseId === 'bb_squat' || /squat/.test(s.exerciseId));
  assert.deepStrictEqual(squat.map(s => s.type), ['warmup', 'work', 'failure']);
  assert.strictEqual(squat[1].weightKg, 83.91, '185 lb in kilograms');
  assert.strictEqual(squat[1].rir, 2);
  const ext = log.sets.find(s => s.type === 'drop');
  assert.strictEqual(ext.reps, 15);
});

test('FitNotes: kilograms from the column, sets numbered per movement', () => {
  const r = T.historyFromCsv(fx('fitnotes.csv'), {});
  assert.strictEqual(r.format, 'FitNotes');
  assert.strictEqual(r.unit, 'kg');
  assert.strictEqual(r.sessions, 2);
  const dl = r.logs.find(l => l.dateISO === '2026-09-08').sets.filter(s => s.weightKg === 100);
  assert.deepStrictEqual(dl.map(s => s.setIndex), [0, 1]);
});

test('importing the same file twice adds nothing the second time', () => {
  const tr = { logs: [{ id: 'mine', dateISO: '2026-08-01', sets: [] }] };
  const r = T.historyFromCsv(fx('fitnotes.csv'), {});
  assert.strictEqual(T.addImportedLogs(tr, r.logs), 2);
  assert.strictEqual(T.addImportedLogs(tr, T.historyFromCsv(fx('fitnotes.csv'), {}).logs), 0);
  assert.strictEqual(tr.logs.length, 3);
  assert.strictEqual(tr.logs[0].id, 'mine', 'an existing session is untouched');
});

test('how far back to read is honoured and counted', () => {
  const r = T.historyFromCsv(fx('strong.csv'), { units: 'kg', sinceISO: '2026-09-04' });
  assert.strictEqual(r.sessions, 1);
  assert.ok(r.skipped.old > 0);
});

test('something that is not an export is refused politely', () => {
  assert.strictEqual(T.historyFromCsv('hello,world\n1,2\n', {}).ok, false);
  assert.strictEqual(T.historyFromCsv('', {}).ok, false);
  assert.ok(/Strong, Hevy or FitNotes/.test(T.historyFromCsv('a,b\n1,2', {}).reason));
});

test('imported sessions are finished sessions, and feed history, records and trends like any other', () => {
  const r = T.historyFromCsv(fx('strong.csv'), { units: 'kg' });
  assert.ok(r.logs.every(l => l.endedAt && l.imported === 'Strong'));
  assert.ok(r.logs.every(l => !T.sessionOpen(l, '2026-09-05', Date.parse('2026-09-05T12:00:00Z'))), 'none is mistaken for one still open');
  assert.strictEqual(T.exerciseHistory(r.logs, 'bb_bench').length, 1);
  const best = T.bestBefore(r.logs, 'bb_bench', '2026-09-05');
  assert.strictEqual(T.prKind(62.5, 5, best).kind, 'weight', 'imported history is the past a record is judged against');
});

// ---- on screen ----------------------------------------------------------------------------------

const { app, mount, accountWith } = require('./helpers/app.js');
const A = app();
const flush = () => new Promise(r => setTimeout(r, 20));

async function openImport(file, name) {
  const db = accountWith();
  const ui = mount(A.HistoryImport, { db, update(fn) { fn(db); }, showToast() {}, onBack() {}, onDone() {} });
  const input = ui.host.querySelector('input[type="file"]');
  const f = new A.File([fs.readFileSync(path.join(__dirname, 'fixtures', 'history', file), 'utf8')], name || file, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  const { act } = require('./helpers/app.js').React;
  await act(async () => { input.dispatchEvent(new A.Event('change', { bubbles: true })); await flush(); });
  return { ui, db };
}

test('picking a Strong file asks for the unit before it offers to add anything', async () => {
  const { ui, db } = await openImport('strong.csv');
  try {
    assert.ok(ui.has('Strong export'), ui.text.slice(0, 400));
    assert.ok(ui.has('Which unit are the weights in?'));
    assert.ok(ui.has('Pick a unit first'));
    assert.strictEqual(db.training.logs.length, 0);
  } finally { ui.unmount(); }
});

test('with the unit chosen it lists the names it could not place and adds the sessions', async () => {
  const { ui, db } = await openImport('strong.csv');
  try {
    ui.click('Kilograms');
    assert.ok(ui.has('Wobble Thing Of Mystery'), 'the unplaced name is shown: ' + ui.text.slice(0, 600));
    ui.click('Add 2 sessions');
    assert.strictEqual(db.training.logs.length, 2);
    assert.ok(db.training.logs.every(l => l.imported === 'Strong'));
    assert.ok(!db.training.logs.some(l => l.sets.some(s => s.weightKg === 10)), 'a name with no match at all is left out');
  } finally { ui.unmount(); }
});

test('a Hevy file needs no questions about units, and importing it twice adds it once', async () => {
  const { ui, db } = await openImport('hevy.csv');
  try {
    assert.ok(!ui.has('Which unit are the weights in?'));
    ui.click('Add 1 session');
    assert.strictEqual(db.training.logs.length, 1);
  } finally { ui.unmount(); }
  const again = await openImport('hevy.csv');
  try {
    again.db.training.logs = db.training.logs.slice();
    again.ui.click('Add 1 session');
    assert.strictEqual(again.db.training.logs.length, 1, 'the same session is not added again');
  } finally { again.ui.unmount(); }
});

test('something that is not an export says so and offers nothing', async () => {
  const db = accountWith();
  const ui = mount(A.HistoryImport, { db, update(fn) { fn(db); }, showToast() {}, onBack() {}, onDone() {} });
  try {
    const input = ui.host.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new A.File(['a,b\n1,2\n'], 'x.csv')], configurable: true });
    await require('./helpers/app.js').React.act(async () => { input.dispatchEvent(new A.Event('change', { bubbles: true })); await flush(); });
    assert.ok(ui.has('does not look like a Strong, Hevy or FitNotes export'));
    assert.ok(!ui.has('Add '));
  } finally { ui.unmount(); }
});

test('a name with only a close match becomes a variation of it, once, and a rerun reuses it', async () => {
  const csv = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n'
    + '2026-09-01 10:00:00,Arms,30m,Overhead Press (Dumbbell),1,12,10,0,0,,,\n'
    + '2026-09-08 10:00:00,Arms,30m,Overhead Press (Dumbbell),1,14,10,0,0,,,\n';
  const db = accountWith();
  const ui = mount(A.HistoryImport, { db, update(fn) { fn(db); }, showToast() {}, onBack() {}, onDone() {} });
  try {
    const input = ui.host.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new A.File([csv], 'strong.csv')], configurable: true });
    await require('./helpers/app.js').React.act(async () => { input.dispatchEvent(new A.Event('change', { bubbles: true })); await flush(); });
    ui.click('Kilograms');
    assert.ok(ui.has('closest is'), ui.text.slice(0, 500));
    ui.click('Add 2 sessions');
    assert.strictEqual(db.training.custom.length, 1, 'one new movement, not one per session');
    const made = db.training.custom[0];
    assert.strictEqual(made.name, 'Overhead Press (Dumbbell)');
    assert.ok(made.variantOf && made.primary.length, 'it inherits what its closest match trains');
    assert.ok(db.training.logs.every(l => l.sets.every(s => s.exerciseId === made.id)));
  } finally { ui.unmount(); }
});
