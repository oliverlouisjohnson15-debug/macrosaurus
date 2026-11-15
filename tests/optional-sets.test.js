'use strict';
// "2-3 sets" lines, your own rest time, and PPL Hybrid's leg-day abs.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;

test('a line with an optional set lays out its sets and then the optional one', () => {
  const pre = T.prefillSets({ exerciseId: 'db_curl', target: { sets: 2, setsOptional: 1, repLow: 8, repHigh: 12, rir: 0, rirLast: 0 } }, [], []);
  assert.equal(pre.sets.length, 3);
  assert.deepEqual(pre.sets.map(s => !!s.optional), [false, false, true]);
  assert.equal(T.setsLabel({ sets: 2, setsOptional: 1 }), '2-3');
  assert.equal(T.setsLabel({ sets: 3 }), '3');
});

test('PPL Hybrid: "2-3 sets" lines are two plus an optional third, rest is three minutes, abs on both leg days', () => {
  const p = T.programmeOf('pplh5');
  const upper = p.template.find(d => d.name === 'Upper').exercises;
  for (const id of ['machine_overhead_extension', 'db_curl']) {
    const e = upper.find(x => x.exerciseId === id);
    assert.deepEqual([e.target.sets, e.target.setsOptional], [2, 1], id);
  }
  for (const d of p.template) for (const e of d.exercises) assert.equal(e.target.restSec, 180, d.name + ' ' + e.exerciseId);
  for (const name of ['Lower 1', 'Legs 2']) {
    const ids = p.template.find(d => d.name === name).exercises.map(e => e.exerciseId);
    assert.equal(ids[0], 'hanging_knee_raise', name + ' opens with hanging knee raises');
    assert.equal(ids[ids.length - 1], 'machine_crunch2', name + ' finishes with the machine crunch');
  }
  // It survives being turned into a block.
  const b = T.programmeBlock('pplh5');
  const line = T.weekSessions(b, 1)[0].exercises.find(e => e.exerciseId === 'db_curl');
  assert.equal(line.target.setsOptional, 1);
});

function upperDay(prefs) {
  const block = T.programmeBlock('pplh5', { startISO: A.Store.todayISO() });
  const db = accountWith(block);
  Object.assign(db.training.prefs, { restTimer: true }, prefs || {});
  const session = T.weekSessions(block, 1).find(s => s.name === 'Upper');
  let live = db;
  const ui = mount(A.SessionPlayer, {
    db: live, showToast() {}, onExit() {}, onFinish() {}, onFocusMode() {},
    sessionId: session.id, blockId: block.id, update(fn) { fn(live); },
  });
  return { ui, live: () => live };
}

test('the optional set is shown, and a movement is finished without it', () => {
  const { ui } = upperDay();
  try {
    assert.ok(ui.has('2-3 x'), 'a closed 2-3 line reads as one: ' + ui.text.slice(0, 600));
    const head = Array.from(ui.host.querySelectorAll('button')).find(b => /Machine overhead triceps extension/.test(b.textContent) && /2-3 x/.test(b.textContent));
    ui.clickEl(head);
    assert.ok(ui.has('Optional: tick it if you have another set in you'), 'the optional row says what it is');
    assert.ok(ui.has('Set 1 of 2'), 'and is not counted as one of the sets to do');
    ui.clickEl(ui.host.querySelector('[aria-label="Mark set 1 done"]'));
    ui.clickEl(ui.host.querySelector('[aria-label="Mark set 2 done"]'));
    assert.ok(ui.has('1 of 8 done'), 'two sets in and the movement is done: ' + ui.text.slice(0, 200));
  } finally { ui.unmount(); }
});

test('your rest time replaces the plan\'s on every set', () => {
  const plan = upperDay();
  try { assert.ok(plan.ui.has('3m2 sets'), 'the plan\'s three minutes by default: ' + plan.ui.text.slice(0, 500)); }
  finally { plan.ui.unmount(); }
  const own = upperDay({ restSec: 150 });
  try { assert.ok(own.ui.has('2m302 sets'), 'and yours when set: ' + own.ui.text.slice(0, 500)); }
  finally { own.ui.unmount(); }
});
