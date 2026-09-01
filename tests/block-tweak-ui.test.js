'use strict';
/* Asking the block builder for a change in words.
 *
 * The engine half of this lives in tests/block-tweak.test.js. This is the other half: that the
 * control is actually on the screen a programme opens into, that the suggestions are read off the
 * block in front of you rather than being five stock examples, that what it did is shown in full
 * before you keep it, and that Undo puts the block back. The model is stubbed, because what is under
 * test is everything the app does with what comes back.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith, React } = require('./helpers/app.js');

const A = app();
const T = A.Training;

/* Filling the box, through a suggestion chip.
 *
 * Not by typing: react-dom is loaded into this harness before jsdom's globals are in place, so its
 * change plugin never registers and a dispatched `input` event does not reach onChange. Clicks do,
 * which is what every other mounted test in the suite leans on. The chips are a real control that
 * sets the same state, and going through them tests the path the screen actually recommends - the
 * whole point of them is that most people should never be typing into an empty box. */
const CHIP = 'Sore shoulder';
const CHIP_TEXT = 'My left shoulder does not like pressing overhead at the moment. Change anything that aggravates it.';
function type(ui) {
  ui.click(CHIP);
  assert.equal(ui.host.querySelector('textarea').value, CHIP_TEXT, 'the chip filled the box');
}
async function press(ui, label) {
  const el = Array.from(ui.host.querySelectorAll('button'))
    .filter(b => b.textContent.replace(/\s+/g, ' ').indexOf(label) !== -1)
    .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  assert.ok(el, 'nothing to press reading "' + label + '" in: ' + ui.text.slice(0, 400));
  await React.act(async () => { el.dispatchEvent(new A.MouseEvent('click', { bubbles: true })); });
}
// The model, answering. Restored after every test so one stub cannot leak into the next.
function withAI(reply, fn) {
  const real = A.aiTweakBlock;
  A.aiTweakBlock = () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply));
  return Promise.resolve().then(fn).finally(() => { A.aiTweakBlock = real; });
}
// A five-day programme, opened in the builder exactly as tapping its card does it.
function programmeUI() {
  const draft = T.programmeBlock('mac5', { startISO: A.Store.todayISO() });
  const db = accountWith(T.generateBlock({ daysPerWeek: 4, weeks: 4 }));
  db.training.blocks = [];
  return mount(A.BlockBuilder, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, draft, onBack() {}, onSchedule() {},
  });
}

test('the way to ask for a change is on the screen a programme opens into', () => {
  const ui = programmeUI();
  try {
    assert.ok(ui.has('Change something'), 'the card is there: ' + ui.text.slice(0, 500));
    assert.ok(ui.has('in every week you have not trained yet'), 'and it says how far a change reaches');
    assert.ok(ui.host.querySelector('textarea'), 'with somewhere to say it');
  } finally { ui.unmount(); }
});

test('the suggestions are read off this block, not five stock examples', () => {
  const ui = programmeUI();
  try {
    // Every chip has to be a sentence about something true of the plan in front of you. The one that
    // is always available is the swap, because it is what people want from a written programme.
    assert.ok(ui.has('Swap a movement'), 'the chips are there: ' + ui.text.slice(0, 600));
    // And tapping one FILLS the box rather than sending it: the chip knows the plan, the person
    // knows which shoulder it is.
    ui.click('Swap a movement');
    assert.equal(ui.host.querySelector('textarea').value, 'Swap ');
  } finally { ui.unmount(); }
});

test('pressing it with nothing typed says what to do rather than sitting dead', async () => {
  const ui = programmeUI();
  try {
    await press(ui, 'Change the plan');
    assert.ok(ui.has('Tell me what you want changed first'), 'it answers: ' + ui.text.slice(0, 400));
  } finally { ui.unmount(); }
});

test('a change lands in the plan, says exactly what it did, and can be put back', async () => {
  const ui = programmeUI();
  try {
    await withAI({
      note: 'Swapped the incline press for the machine, since your gym has not got a spare bench.',
      changes: [{ op: 'swap', from: 'Barbell Incline Press', to: 'Machine Chest Press' }],
    }, async () => {
      type(ui);
      await press(ui, 'Change the plan');
    });
    assert.ok(ui.has('since your gym has not got a spare bench'), 'the note is shown: ' + ui.text.slice(0, 600));
    // The receipt names the movement, what it became, and how far it reached. A block is four weeks
    // of twenty sessions and "done!" over the top of it is not something anybody can check.
    assert.ok(ui.has('Incline barbell press'), 'the receipt names what moved: ' + ui.text.slice(0, 800));
    assert.ok(ui.has('Machine chest press'), 'and what it became');
    assert.ok(ui.has('all 4 weeks'), 'and how far it went');

    // The plan itself changed, not just the receipt.
    ui.click('Upper 1');
    assert.ok(ui.has('instead of Incline barbell press'), 'the day card shows the swap: ' + ui.text.slice(0, 900));

    await press(ui, 'Undo that change');
    assert.ok(!ui.has('all 4 weeks'), 'the receipt goes with it');
    assert.ok(!ui.has('Machine chest press'), 'and so does the change: ' + ui.text.slice(0, 900));
    // And what you asked for comes back into the box, so a near miss is one word away from a retry
    // rather than a retype.
    assert.equal(ui.host.querySelector('textarea').value, CHIP_TEXT);
  } finally { ui.unmount(); }
});

test('what it would not do is said out loud, not silently skipped', async () => {
  const ui = programmeUI();
  try {
    await withAI({
      note: '',
      changes: [{ op: 'swap', from: 'Pec Deck', to: 'Reverse Gravitron Sky Press' }],
    }, async () => {
      type(ui);
      await press(ui, 'Change the plan');
    });
    assert.ok(ui.has('Reverse Gravitron Sky Press'), 'it names what it could not find: ' + ui.text.slice(0, 600));
    assert.ok(!ui.has('Undo that change'), 'and offers nothing to undo, because nothing changed');
  } finally { ui.unmount(); }
});

test('a model that falls over does not take the block with it', async () => {
  const ui = programmeUI();
  try {
    await withAI(new Error('That took too long to come back.'), async () => {
      type(ui);
      await press(ui, 'Change the plan');
    });
    assert.ok(ui.has('That took too long to come back.'), 'it says so: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Upper 1'), 'and the block is still on screen');
  } finally { ui.unmount(); }
});

test('the way back to the programme as written is one tap', () => {
  const ui = programmeUI();
  try {
    assert.ok(ui.has('Start again from Macrosaurus 5 Day as written'), 'offered: ' + ui.text.slice(0, 700));
  } finally { ui.unmount(); }
});

test('a block that is not a programme is not offered a programme to go back to', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const db = accountWith(block);
  const ui = mount(A.BlockBuilder, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, blockId: block.id, onBack() {}, onStart() {},
  });
  try {
    assert.ok(ui.has('Change something'), 'the tweak box is on every block, not just the written ones');
    assert.ok(!ui.has('as written'), 'but there is no programme behind this one: ' + ui.text.slice(0, 400));
  } finally { ui.unmount(); }
});

test('a free account is sent to the paywall rather than to the model', async () => {
  const draft = T.programmeBlock('mac5', { startISO: A.Store.todayISO() });
  const db = accountWith(T.generateBlock({ daysPerWeek: 4, weeks: 4 }));
  db.training.blocks = [];
  let asked = null, called = false;
  const real = A.aiTweakBlock;
  A.aiTweakBlock = () => { called = true; return Promise.resolve({ note: '', changes: [] }); };
  const ui = mount(A.BlockBuilder, {
    db, update() {}, showToast() {}, isPremium: false, onUpgrade(r) { asked = r; }, draft, onBack() {}, onSchedule() {},
  });
  try {
    assert.ok(ui.has('Change the plan · Premium'), 'the button says so before you press it: ' + ui.text.slice(0, 500));
    type(ui);
    await press(ui, 'Change the plan');
    assert.equal(asked, 'workout_import');
    assert.equal(called, false, 'nothing was sent');
  } finally { ui.unmount(); A.aiTweakBlock = real; }
});

/* The way IN, from the screen people actually read their week on.
 *
 * The builder is the right home for changing a plan, and for a while it was the ONLY way in: three
 * taps down, behind a button called "Blocks", on a screen headed "Edit block". That is how a feature
 * ships and stays invisible - which is exactly what happened. */
test('the Train tab offers a way to change the block you are looking at', () => {
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  let went = null;
  const ui = mount(A.TrainHome, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block,
    onOpen() {}, onResume() {}, onFreeform() {}, go: (name, opts) => { went = { name, opts }; },
  });
  try {
    assert.ok(ui.has('Change this block'), 'the route is on the week you are reading: ' + ui.text.slice(0, 600));
    ui.click('Change this block');
    assert.equal(went && went.name, 'builder');
    assert.equal(went.opts.blockId, block.id, 'it opens the block you were looking at');
    assert.equal(went.opts.tweak, true, 'and asks the builder to open on the change card');
  } finally { ui.unmount(); }
});

test('a finished block is not offered a plan to change', () => {
  // The block is over; the thing to do with it is read the review, not edit weeks that have all been
  // trained. Train home draws a different card entirely in that state.
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  const start = new Date(Date.parse(A.Store.todayISO() + 'T00:00:00Z') - 70 * 86400000);
  block.startISO = start.toISOString().slice(0, 10);
  db.training.blocks = [block];
  const ui = mount(A.TrainHome, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block,
    onOpen() {}, onResume() {}, onFreeform() {}, go() {},
  });
  try {
    assert.ok(!ui.has('Change this block'), 'nothing to change on a block that is over: ' + ui.text.slice(0, 400));
  } finally { ui.unmount(); }
});
