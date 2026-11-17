'use strict';
/* Logging a set in the session player: the per-set "last time" line, the steppers, the back-off set
 * that follows the weight you actually lifted, and the coaching note giving way once you start. */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;
const minmax = () => T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
const kg = (w) => w + 'kg';

test('vsLastTime: same weight compares reps, heavier says by how much, lighter uses e1RM', () => {
  const at = (w, r, lw, lr) => A.vsLastTime({ done: true, weightKg: w, reps: r, lastTime: { weightKg: lw, reps: lr } }, kg);
  assert.deepEqual(at(45, 9, 45, 6), { tone: 'ahead', text: '+3 reps on last time' });
  assert.deepEqual(at(45, 6, 45, 6), { tone: 'level', text: 'Matched last time' });
  assert.equal(at(45, 5, 45, 6).tone, 'behind');
  assert.deepEqual(at(47.5, 6, 45, 6), { tone: 'ahead', text: '+2.5kg on last time' });
  assert.equal(at(40, 12, 45, 6).tone, 'ahead', 'twelve at 40 beats six at 45');
  assert.equal(at(40, 9, 45, 6).tone, 'behind', 'nine at 40 does not');
  assert.equal(at(40, 6, 45, 6).tone, 'behind');
  assert.equal(A.vsLastTime({ done: false, weightKg: 45, reps: 9, lastTime: { weightKg: 45, reps: 6 } }, kg), null);
});

test('soFarLine sums the movement up once sets are in', () => {
  const set = (w, r, lw, lr) => ({ done: true, weightKg: w, reps: r, lastTime: { weightKg: lw, reps: lr } });
  assert.equal(A.soFarLine([set(45, 9, 45, 6), set(45, 8, 45, 7)], kg).text, 'Both sets so far ahead of last time.');
  assert.equal(A.soFarLine([set(45, 9, 45, 6), set(45, 5, 45, 7)], kg).text, '1 of 2 sets so far ahead of last time.');
  assert.equal(A.soFarLine([{ done: false }], kg), null);
});

// Week 2's first session has a both-to-failure isolation line, which is where back-off sets live.
function withHistory() {
  const block = minmax();
  const session = T.weekSessions(block, 2)[0];
  const items = T.sessionItems(session);
  const sets = [];
  items.forEach(it => [[40, 7], [34, 7]].forEach(([w, r], i) => sets.push({ exerciseId: it.exerciseId, weightKg: w, reps: r, done: true, type: 'work', setIndex: i })));
  const d = accountWith(block);
  d.training.logs = [{ id: 'old', dateISO: '2020-01-01', sets }];
  return { block, session, items, d };
}
const props = ({ block, session, d }) => ({ db: d, update(fn) { fn(d); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {} });

test('each set says what it did last time, and the summary line above the table is gone', () => {
  const ctx = withHistory();
  const ui = mount(A.SessionPlayer, props(ctx));
  try {
    assert.ok(ui.has('Last time 40kg × 7'), ui.text.slice(0, 900));
    assert.ok(!ui.has('Last time:'), 'no separate summary line');
  } finally { ui.unmount(); }
});

test('the steppers nudge the set you are on, from what it shows', () => {
  const ctx = withHistory();
  const ui = mount(A.SessionPlayer, props(ctx));
  try {
    const box = ui.host.querySelector('input[inputmode="decimal"]');
    const before = +(box.value || box.placeholder);
    ui.clickEl(ui.host.querySelector('button[aria-label^="Weight up"]'));
    assert.ok(+box.value > before, before + ' -> ' + box.value);
    const reps = ui.host.querySelectorAll('input[inputmode="numeric"]')[0];
    ui.clickEl(ui.host.querySelector('button[aria-label="One rep more"]'));
    assert.equal(+reps.value, +reps.placeholder + 1);
  } finally { ui.unmount(); }
});

test('a back-off set follows the top-set weight you actually typed', () => {
  const ctx = withHistory();
  const ii = ctx.items.findIndex(it => it.target && it.target.rir === 0);
  assert.ok(ii > 0, 'fixture has a both-to-failure line');
  const name = T.byId(ctx.items[ii].exerciseId).name;
  const ui = mount(A.SessionPlayer, props(ctx));
  try {
    const header = Array.from(ui.host.querySelectorAll('button')).filter(b => b.textContent.indexOf(name) !== -1 && !/^Reorder/.test(b.getAttribute('aria-label') || ''))[0];
    ui.clickEl(header);
    assert.ok(/back-off, 15% under your/i.test(ui.text), 'the back-off row says what it is under: ' + ui.text.slice(0, 1200));
    const boxes = ui.host.querySelectorAll('input[inputmode="decimal"]');
    ui.type(boxes[0], '50');
    const spec = T.loadSpecFor(ctx.items[ii].exerciseId, {});
    assert.equal(+boxes[1].value, T.toMachine(T.backOffLoad(50, T.byId(ctx.items[ii].exerciseId), spec), spec));
    assert.ok(ui.has('15% under your 50kg top set'));
  } finally { ui.unmount(); }
});

test('a fixed rep target reads "10 reps", not "10–10 reps"', () => {
  const ctx = withHistory();
  ctx.session.exercises.forEach(x => { if (x.target) { x.target.repLow = 10; x.target.repHigh = 10; } });
  const ui = mount(A.SessionPlayer, props(ctx));
  try {
    assert.ok(!ui.has('10–10'), 'no doubled range');
    assert.ok(/sets? · 10 reps/.test(ui.text));
  } finally { ui.unmount(); }
});
