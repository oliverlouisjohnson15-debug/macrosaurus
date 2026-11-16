'use strict';
// Changing a line's sets and reps for today, or for the rest of the programme.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;

test('patchTarget keeps the range the right way up and in bounds', () => {
  assert.deepEqual(T.patchTarget({ repLow: 8, repHigh: 12 }, { repLow: 14 }), { repLow: 14, repHigh: 14 });
  assert.deepEqual(T.patchTarget({ repLow: 8, repHigh: 12 }, { repHigh: 6 }), { repLow: 6, repHigh: 6 });
});

test('the rest of the programme changes this line from this week on; snapshot puts it back', () => {
  const b = T.programmeBlock('pplh5');
  const w = (n) => T.weekSessions(b, n).find(s => s.name === 'Pull');
  const line = (n) => w(n).exercises.find(e => e.sourceName === 'Hammer Curl');
  const snap = T.targetSnapshot(b, w(2).id, line(2).id, 2);
  T.setTargetInBlock(b, w(2).id, line(2).id, { repLow: 10, repHigh: 15 }, 2);
  assert.equal(line(1).target.repLow, 8, 'week 1 is behind you');
  for (const n of [2, 3, 4]) assert.deepEqual([line(n).target.repLow, line(n).target.repHigh], [10, 15], 'week ' + n);
  T.restoreTargets(b, snap);
  assert.equal(line(3).target.repLow, 8);
});

function pullDay() {
  const block = T.programmeBlock('pplh5', { startISO: A.Store.todayISO() });
  const live = accountWith(block);
  live.training.blocks[0].startISO = A.Store.todayISO();
  const b = live.training.blocks[0];
  const session = T.weekSessions(b, 1).find(s => s.name === 'Pull');
  const ui = mount(A.SessionPlayer, {
    db: live, showToast() {}, onExit() {}, onFinish() {}, onFocusMode() {},
    sessionId: session.id, blockId: b.id, update(fn) { fn(live); },
  });
  return { ui, live, b };
}
const hammer = (b, n) => T.weekSessions(b, n).find(s => s.name === 'Pull').exercises.find(e => e.sourceName === 'Hammer Curl').target;

test('at the gym: the card\'s sets and reps open the sheet; Today only leaves the programme alone', () => {
  const { ui, b } = pullDay();
  try {
    // Hammer curl is third on Pull; open it, then its prescription.
    ui.clickEl(Array.from(ui.host.querySelectorAll('button')).find(x => /Hammer curl/.test(x.textContent) && x.textContent.length < 80));
    ui.clickEl(ui.host.querySelector('[aria-label^="Change sets and reps"]'));
    assert.ok(ui.findEl('Rest of programme'), 'the sheet asks how far: ' + ui.text.slice(-400));
    ui.clickEl(ui.findEl('10–15'));
    assert.equal(hammer(b, 2).repLow, 8, 'today only: next week is untouched');
  } finally { ui.unmount(); }
});

test('at the gym: Rest of programme carries the new range into every week still to come', () => {
  const { ui, b } = pullDay();
  try {
    ui.clickEl(Array.from(ui.host.querySelectorAll('button')).find(x => /Hammer curl/.test(x.textContent) && x.textContent.length < 80));
    ui.clickEl(ui.host.querySelector('[aria-label^="Change sets and reps"]'));
    ui.clickEl(ui.findEl('Rest of programme'));
    assert.ok(ui.has('from this week on'));
    ui.clickEl(ui.findEl('12–20'));
    for (const n of [1, 2, 3, 4]) assert.deepEqual([hammer(b, n).repLow, hammer(b, n).repHigh], [12, 20], 'week ' + n);
    // Changing your mind is a true undo.
    ui.clickEl(ui.findEl('Today only'));
    for (const n of [2, 3, 4]) assert.deepEqual([hammer(b, n).repLow, hammer(b, n).repHigh], [8, 12], 'back, week ' + n);
  } finally { ui.unmount(); }
});
