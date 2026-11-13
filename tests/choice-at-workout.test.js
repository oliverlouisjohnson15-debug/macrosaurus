'use strict';
/* "X or Y" lines, answered at the workout rather than only in the block builder.
 *
 * A written programme that says "Pendulum Squat or Barbell Back Squat" is handing the person the
 * decision, and the moment they actually make it is when they open the session and see which one is
 * free. These hold the three promises that makes:
 *   - a pick changes this week and every week after it, never a week already trained;
 *   - it answers the QUESTION, so every day that shares the slot moves with it;
 *   - once a set is ticked against the line the toggle is locked, because the lift has answered it.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;

const QUAD_DAY = 'Legs B';
const squatLines = (block) => block.sessions.flatMap(s => s.exercises
  .filter(e => e.choice && e.choice.key === 'squat')
  .map(e => ({ week: s.week, day: s.name, id: e.exerciseId })));

test('a pick from week 2 changes weeks 2 on and leaves week 1 as it was lifted', () => {
  const b = T.programmeBlock('qp5');
  const n = T.applyChoiceFrom(b, 'squat', 'back_squat', 2);
  assert.equal(n, 3, 'weeks 2, 3 and 4');
  for (const l of squatLines(b)) assert.equal(l.id, l.week === 1 ? 'pendulum_squat' : 'back_squat', 'week ' + l.week);
  // And it is a question answered, not a replacement: no "instead of" left behind.
  const row = b.sessions.find(s => s.week === 2 && s.name === QUAD_DAY).exercises.find(e => e.choice && e.choice.key === 'squat');
  assert.equal(row.baseExerciseId, undefined);
  assert.ok(row.planNote, 'the author\'s note stays on the line');
});

test('a pick answers every day that shares the question', () => {
  const b = T.programmeBlock('qp5');
  // Give the posterior-chain day the same leg-curl question the quad day has.
  b.sessions.filter(s => s.name === 'Legs A').forEach(s => {
    const first = s.exercises.find(e => e.order === 0);
    const curl = b.sessions.find(x => x.name === QUAD_DAY).exercises.find(e => e.choice && e.choice.key === 'leg_curl');
    first.exerciseId = 'lying_leg_curl';
    first.choice = JSON.parse(JSON.stringify(curl.choice));
  });
  assert.equal(T.applyChoiceFrom(b, 'leg_curl', 'standing_leg_curl', 1), 8, 'two days a week, four weeks');
  const ids = b.sessions.flatMap(s => s.exercises.filter(e => e.choice && e.choice.key === 'leg_curl').map(e => e.exerciseId));
  assert.deepEqual([...new Set(ids)], ['standing_leg_curl']);
});

test('a pick that is not one of the options, or is already the answer, changes nothing', () => {
  const b = T.programmeBlock('qp5');
  assert.equal(T.applyChoiceFrom(b, 'squat', 'leg_press', 1), 0);
  assert.equal(T.applyChoiceFrom(b, 'squat', 'pendulum_squat', 1), 0);
  assert.equal(T.applyChoiceFrom(b, 'no_such_slot', 'back_squat', 1), 0);
});

function quadDayAccount() {
  const block = T.programmeBlock('qp5');
  const db = accountWith(block);
  const session = block.sessions.find(s => s.week === 1 && s.name === QUAD_DAY);
  return { db, block: db.training.blocks[0], session };
}
const toggles = (ui) => Array.from(ui.host.querySelectorAll('[aria-pressed]'));
const toggle = (ui, name) => toggles(ui).find(b => b.textContent.trim() === name);

test('the workout preview shows the options on the line, and a tap answers it for the block', () => {
  const { db, block, session } = quadDayAccount();
  const ui = mount(A.SessionPreview, {
    db, update(fn) { fn(db); }, showToast() {}, session, block, onBack() {}, onStart() {},
  });
  try {
    assert.ok(toggle(ui, 'Pendulum squat') && toggle(ui, 'Back squat'), 'both squats on the line');
    assert.ok(toggle(ui, 'Lying leg curl') && toggle(ui, 'Standing leg curl'), 'and both curls');
    assert.equal(toggle(ui, 'Pendulum squat').getAttribute('aria-pressed'), 'true', 'the current answer is shown');
    ui.clickEl(toggle(ui, 'Back squat'));
  } finally { ui.unmount(); }
  const lines = squatLines(db.training.blocks[0]);
  assert.deepEqual([...new Set(lines.map(l => l.id))], ['back_squat'], 'every week from this one on');
});

test('the live session swaps the line, refilled from that movement, and the block follows', () => {
  const { db, block, session } = quadDayAccount();
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    const before = toggle(ui, 'Lying leg curl');
    assert.ok(before, 'the opening line is an either/or: ' + ui.text.slice(0, 300));
    assert.equal(before.getAttribute('aria-pressed'), 'true');
    ui.clickEl(toggle(ui, 'Standing leg curl'));
    assert.equal(toggle(ui, 'Standing leg curl').getAttribute('aria-pressed'), 'true', 'today\'s line is the new one');
  } finally { ui.unmount(); }
  const curls = db.training.blocks[0].sessions.flatMap(s => s.exercises.filter(e => e.choice && e.choice.key === 'leg_curl').map(e => e.exerciseId));
  assert.deepEqual([...new Set(curls)], ['standing_leg_curl']);
});

test('once a set is ticked on the line, the toggle is locked', () => {
  const { db, block, session } = quadDayAccount();
  const first = session.exercises.find(e => e.order === 0);
  db.training.logs = [{
    id: 'log_q', dateISO: A.Store.todayISO(), blockId: block.id, sessionId: session.id, name: session.name,
    startedAt: new Date().toISOString(), endedAt: null,
    sets: [{ exerciseId: first.exerciseId, itemId: first.id, setIndex: 0, type: 'work', weightKg: 40, reps: 10, rir: 1, done: true }],
  }];
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    const other = toggle(ui, 'Standing leg curl');
    assert.ok(other, 'the options are still shown: ' + ui.text.slice(0, 300));
    assert.ok(other.disabled, 'but the one not picked cannot be');
    ui.clickEl(other);
    assert.equal(toggle(ui, 'Lying leg curl').getAttribute('aria-pressed'), 'true');
  } finally { ui.unmount(); }
  assert.equal(db.training.blocks[0].sessions.find(s => s.id === session.id).exercises.find(e => e.order === 0).exerciseId, 'lying_leg_curl');
});
