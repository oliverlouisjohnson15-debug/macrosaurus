'use strict';
/* The block builder, as a written programme opens into it.
 *
 * The free-text "change something" box that used to live here was removed along with the other AI
 * block builders: training is built around the written programmes now, and a plan is changed by hand
 * (swap, sets, reps, days) on the screens that show it. The engine half of the old feature,
 * Training.blockTweak, is still covered in tests/block-tweak.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;

// A five-day programme, opened in the builder exactly as tapping its card does it.
function programmeUI() {
  const draft = T.programmeBlock('mac5', { startISO: A.Store.todayISO() });
  const db = accountWith(T.generateBlock({ daysPerWeek: 4, weeks: 4 }));
  db.training.blocks = [];
  return mount(A.BlockBuilder, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, draft, onBack() {}, onSchedule() {},
  });
}

test('the way back to the programme as written is one tap', () => {
  const ui = programmeUI();
  try {
    assert.ok(ui.has('Start again from T-Rex as written'), 'offered: ' + ui.text.slice(0, 700));
  } finally { ui.unmount(); }
});

test('the builder no longer asks for a change in words', () => {
  const ui = programmeUI();
  try {
    assert.ok(!ui.has('Change something'), 'the AI change box is gone: ' + ui.text.slice(0, 400));
    assert.ok(!ui.host.querySelector('textarea'), 'and so is its text box');
  } finally { ui.unmount(); }
});

test('a block that is not a programme is not offered a programme to go back to', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const db = accountWith(block);
  const ui = mount(A.BlockBuilder, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, blockId: block.id, onBack() {}, onStart() {},
  });
  try {
    assert.ok(!ui.has('as written'), 'there is no programme behind this one: ' + ui.text.slice(0, 400));
  } finally { ui.unmount(); }
});

test('the Train tab does not offer an AI rewrite of the running block', () => {
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  const ui = mount(A.TrainHome, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block,
    onOpen() {}, onResume() {}, onFreeform() {}, go() {},
  });
  try {
    assert.ok(!ui.has('Change this block'), ui.text.slice(0, 400));
  } finally { ui.unmount(); }
});
