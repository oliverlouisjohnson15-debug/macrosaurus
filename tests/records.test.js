'use strict';
// Records and progress for the work the old maths could not see: bodyweight movements, sets past
// twelve reps, and reps at a weight lighter than your heaviest. Plus the fixed-rep window.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

const set = (over) => Object.assign({ exerciseId: 'x', type: 'work', done: true, weightKg: 0, reps: 8 }, over);
const log = (id, dateISO, sets) => ({ id, dateISO, sets });

// ---- reps at any weight you have used -----------------------------------------------------------

test('more reps than ever at a working weight below your heaviest is a record', () => {
  const logs = [log('a', '2026-09-01', [set({ weightKg: 60, reps: 6 }), set({ weightKg: 50, reps: 10 })])];
  const best = T.bestBefore(logs, 'x', '2026-09-08');
  assert.strictEqual(T.prKind(50, 11, best).kind, 'reps');
  assert.strictEqual(T.prKind(50, 11, best).label, 'Most reps at 50');
  assert.strictEqual(T.prKind(50, 10, best), null, 'equalling it is not a record');
});

test('a weight you have never used is not a reps record', () => {
  const best = T.bestBefore([log('a', '2026-09-01', [set({ weightKg: 60, reps: 6 })])], 'x', '2026-09-08');
  assert.strictEqual(T.prKind(55, 4, best), null);
});

test('the heaviest-weight record behaves exactly as it did', () => {
  const best = T.bestBefore([log('a', '2026-09-01', [set({ weightKg: 60, reps: 6 })])], 'x', '2026-09-08');
  assert.strictEqual(T.prKind(62.5, 3, best).kind, 'weight');
  assert.strictEqual(T.prKind(62.5, 3, best).label, 'Heaviest ever');
});

test('a first-ever set is never a record', () => {
  assert.strictEqual(T.prKind(60, 8, T.bestBefore([], 'x', '2026-09-08')), null);
});

test('past twelve reps there is no 1RM but weight and reps records still count', () => {
  const best = T.bestBefore([log('a', '2026-09-01', [set({ weightKg: 12, reps: 15 })])], 'x', '2026-09-08');
  assert.strictEqual(best.e1rm, 0);
  assert.strictEqual(T.prKind(12, 17, best).kind, 'reps');
  assert.strictEqual(T.prKind(14, 15, best).kind, 'weight');
});

// ---- bodyweight ---------------------------------------------------------------------------------

test('a bodyweight set is you plus what you added', () => {
  assert.strictEqual(T.effectiveLoad({ weightKg: 10, bwKg: 80 }), 90);
  assert.strictEqual(T.effectiveLoad({ weightKg: 0, bwKg: 80 }), 80);
  assert.strictEqual(T.effectiveLoad({ weightKg: -20, bwKg: 80 }), 60, 'assisted');
  assert.strictEqual(T.effectiveLoad({ weightKg: 60 }), 60, 'a loaded movement is just its weight');
});

test('more reps at the same added weight is a record on a bodyweight movement, including +0', () => {
  const logs = [log('a', '2026-09-01', [set({ exerciseId: 'pu', weightKg: 0, bwKg: 80, reps: 8 })])];
  const best = T.bestBefore(logs, 'pu', '2026-09-08');
  const hit = T.prKind(0, 9, best, 80);
  assert.strictEqual(hit.kind, 'reps');
  assert.strictEqual(hit.label, 'Most reps');
  assert.strictEqual(T.prKind(0, 8, best, 80), null);
});

test('putting on body weight is not a record', () => {
  const logs = [log('a', '2026-09-01', [set({ exerciseId: 'pu', weightKg: 0, bwKg: 78, reps: 8 })])];
  const best = T.bestBefore(logs, 'pu', '2026-09-08');
  assert.strictEqual(T.prKind(0, 8, best, 80), null, 'same reps at a heavier body is the same pull-up');
});

test('adding weight to a bodyweight movement is a record', () => {
  const logs = [log('a', '2026-09-01', [set({ exerciseId: 'pu', weightKg: 5, bwKg: 80, reps: 6 })])];
  const best = T.bestBefore(logs, 'pu', '2026-09-08');
  const hit = T.prKind(10, 5, best, 80);
  assert.strictEqual(hit.kind, 'weight');
  assert.strictEqual(hit.label, 'Most added weight');
});

test('a bodyweight movement with no snapshot and no weight is still not a record candidate', () => {
  assert.strictEqual(T.prKind(0, 12, { e1rm: 0, weightKg: 0, count: 3, repsAt: {} }, 0), null);
});

test('prsInLog counts the earlier sets of the same session, and names one record per movement', () => {
  const prior = [log('a', '2026-09-01', [set({ weightKg: 50, reps: 10 })])];
  const today = log('b', '2026-09-08', [set({ weightKg: 50, reps: 11 }), set({ weightKg: 50, reps: 11 }), set({ weightKg: 50, reps: 12 })]);
  const out = T.prsInLog(prior.concat(today), today);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].value, 12, 'the best of the three, not three records');
});

// ---- history and trends -------------------------------------------------------------------------

test('a lift taken for fifteen has a trend line and a best set, not an empty chart', () => {
  const logs = [1, 2, 3, 4].map(i => log('l' + i, '2026-09-0' + i, [set({ exerciseId: 'lat', weightKg: 10 + i, reps: 15 })]));
  const hist = T.exerciseHistory(logs, 'lat');
  assert.strictEqual(hist.length, 4);
  assert.ok(hist.every(h => h.e1rm === 0 && h.idx > 0 && h.topReps === 15));
  assert.ok(hist[3].idx > hist[0].idx);
  const trend = T.liftTrends(logs, {}).rows.filter(r => r.exerciseId === 'lat')[0];
  assert.ok(trend, 'it shows up in the lifts list');
  assert.strictEqual(trend.metric, 'bestSet');
  assert.strictEqual(trend.state, 'up');
});

test('a lift inside twelve reps is still reported as an estimated 1RM', () => {
  const logs = [1, 2, 3].map(i => log('l' + i, '2026-09-0' + i, [set({ exerciseId: 'sq', weightKg: 80 + i * 2.5, reps: 6 })]));
  const trend = T.liftTrends(logs, {}).rows.filter(r => r.exerciseId === 'sq')[0];
  assert.strictEqual(trend.metric, 'e1rm');
});

test('a stall is read off the index when there is no 1RM', () => {
  const flat = [1, 2, 3].map(i => ({ dateISO: '2026-09-0' + i, e1rm: 0, idx: 24 }));
  assert.ok(T.detectStall(flat));
});

// ---- the fixed-rep window -----------------------------------------------------------------------

const lat = T.byId('lat_pulldown');
const fixedTarget = { sets: 2, repLow: 6, repHigh: 6, rir: 0 };
const run = (target, w, r) => T.progressExercise(target, [{ done: true, weightKg: w, reps: r }], lat, { style: 'minmax' });

test('a fixed target of 6 is read as 6 to 8 for progression only', () => {
  assert.deepStrictEqual(T.progressionWindow(fixedTarget), { low: 6, high: 8, fixed: true });
  assert.deepStrictEqual(T.progressionWindow({ repLow: 6, repHigh: 8 }), { low: 6, high: 8, fixed: false });
});

test('fixed 6: six is same weight and a rep more, eight adds load, five takes ten percent off', () => {
  assert.strictEqual(run(fixedTarget, 60, 6).action, 'reps');
  assert.strictEqual(run(fixedTarget, 60, 7).action, 'reps');
  assert.strictEqual(run(fixedTarget, 60, 8).action, 'load');
  assert.strictEqual(run(fixedTarget, 60, 8).weightKg, 62.5);
  assert.strictEqual(run(fixedTarget, 60, 5).action, 'lighter');
  assert.ok(/plan says 6/i.test(run(fixedTarget, 60, 6).reason));
});

test('a real range is untouched', () => {
  const range = { sets: 2, repLow: 6, repHigh: 8, rir: 0 };
  assert.strictEqual(run(range, 60, 8).action, 'load');
  assert.strictEqual(run(range, 60, 7).action, 'reps');
  assert.strictEqual(run(range, 60, 5).action, 'lighter');
});

// ---- typed-in bodyweight ------------------------------------------------------------------------

test('a weight near your own on a bodyweight movement looks like bodyweight typed in; a plate does not', () => {
  assert.ok(T.looksLikeBodyweight({ weightKg: 98 }, 100));
  assert.ok(T.looksLikeBodyweight({ weightKg: 92 }, 100));
  assert.ok(!T.looksLikeBodyweight({ weightKg: 20 }, 100), 'a plate on a belt');
  assert.ok(!T.looksLikeBodyweight({ weightKg: 98, bwKg: 100 }, 100), 'already read as bodyweight');
  assert.ok(!T.looksLikeBodyweight({ weightKg: 98 }, 0), 'no body weight to compare with');
});

test('retagBodyweight moves the number to the snapshot, only for that movement, and says how many', () => {
  const logs = [
    log('a', '2026-09-01', [set({ exerciseId: 'pu', weightKg: 98, reps: 8 }), set({ exerciseId: 'pu', weightKg: 10, reps: 5 }), set({ exerciseId: 'sq', weightKg: 98, reps: 5 })]),
  ];
  assert.strictEqual(T.retagBodyweight(logs, 'pu', () => 100), 1);
  assert.deepStrictEqual([logs[0].sets[0].weightKg, logs[0].sets[0].bwKg], [0, 98]);
  assert.deepStrictEqual([logs[0].sets[1].weightKg, logs[0].sets[1].bwKg], [10, undefined]);
  assert.strictEqual(logs[0].sets[2].weightKg, 98, 'a squat is a squat');
});

// ---- the session screen -------------------------------------------------------------------------

const { app, mount, accountWith } = require('./helpers/app.js');
const A = app();

function chinSession(extra) {
  const block = A.Training.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block, Object.assign({ profile: { goalType: 'cut', weightKg: 80 } }, extra));
  const session = A.Training.weekSessions(block, 1)[0];
  // Put a bodyweight movement first, so it is the open card.
  const sorted = session.exercises.slice().sort((a, b) => a.order - b.order);
  sorted[0].exerciseId = 'pullup';
  return { block, db, session, first: sorted[0].exerciseId };
}

test('ticking a bodyweight set writes your weight on the day onto it', () => {
  const { block, db, session, first } = chinSession();
  assert.ok(A.Training.byId(first) && A.Training.byId(first).equipment === 'bodyweight', first + ' should be a bodyweight movement');
  const ui = mount(A.SessionPlayer, { db, update(fn) { fn(db); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {} });
  try {
    ui.clickEl(ui.host.querySelector('button[aria-label="Mark set 1 done"]'));
    const done = db.training.logs[0].sets.filter(s => s.exerciseId === first && s.done);
    assert.ok(done.length, 'a set was logged');
    assert.strictEqual(done[0].bwKg, 80);
    assert.ok(/\+\s*kg/i.test(ui.text), 'the column says it is added weight: ' + ui.text.slice(0, 400));
  } finally { ui.unmount(); }
});

test('a rep record on a bodyweight movement fires on a bare tick with nothing added', () => {
  const { block, db, session, first } = chinSession();
  const row = session.exercises.filter(e => e.exerciseId === first)[0];
  db.training.logs = [{
    id: 'old', dateISO: '2026-09-01', name: 'x',
    sets: [{ exerciseId: first, itemId: 'old_item', setIndex: 0, type: 'work', weightKg: 0, bwKg: 80, reps: 5, done: true }],
  }];
  const ui = mount(A.SessionPlayer, { db, update(fn) { fn(db); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {} });
  try {
    const reps = ui.host.querySelector('input[inputmode="numeric"]');
    ui.type(reps, 9);
    ui.clickEl(ui.host.querySelector('button[aria-label="Mark set 1 done"]'));
    assert.ok(ui.has('Most reps'), 'a rep record was announced: ' + ui.text.slice(0, 300));
  } finally { ui.unmount(); }
});
