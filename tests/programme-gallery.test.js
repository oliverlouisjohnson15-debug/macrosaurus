'use strict';
// The programmes as the Train tab's front door: a filterable grid of cards, each opening a preview of
// its whole week, with one button to start it.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;

function emptyAccount() {
  const db = accountWith();
  db.training.blocks = [];
  return db;
}

test('every shipped programme has a card, and a card opens the whole week', () => {
  let picked = null, custom = null;
  const ui = mount(A.ProgrammeGallery, { db: emptyAccount(), onStart: (k, iso) => { picked = [k, iso]; }, onCustomise: (k) => { custom = k; } });
  try {
    for (const p of T.PROGRAMMES) {
      assert.ok(ui.has(p.type), p.name + ' leads with what it is: ' + ui.text.slice(0, 300));
      assert.ok(ui.has(p.author ? 'by ' + p.author : p.name), p.name + ' says whose it is');
    }
    ui.click('Push / pull / legs');
    assert.ok(ui.has('Legs B') && ui.has('Quad focus'), 'the preview lists the days and what each is for: ' + ui.text.slice(0, 300));
    assert.ok(ui.has('Pendulum squat or Back squat'), 'and says an either/or line is one');
    assert.ok(ui.has('4 × 8-12') || ui.has('4 × 8–12'), 'with the written set counts: ' + ui.text.slice(-600));
    ui.click('Start this programme');
    assert.ok(ui.findEl('Start 4 weeks'), 'one question - when - before it starts');
    ui.clickEl(ui.findEl('Start 4 weeks'));
    assert.deepEqual(picked, ['qp5', A.Store.todayISO()], 'starting it hands over the programme and the day');
    assert.equal(custom, null);
  } finally { ui.unmount(); }
});

test('the filters narrow the grid and All brings everything back', () => {
  const ui = mount(A.ProgrammeGallery, { db: emptyAccount(), onStart() {}, onCustomise() {} });
  try {
    ui.click('4 days');
    assert.ok(ui.has('Raptor'));
    assert.ok(!ui.has('T-Rex'), 'five-day plans are filtered out');
    ui.click('Machines');
    assert.ok(ui.has('Stego') && !ui.has('Raptor'));
    ui.click('All');
    for (const p of T.PROGRAMMES) assert.ok(ui.has(p.type), p.name);
  } finally { ui.unmount(); }
});

test('every programme says who it is for', () => {
  for (const p of T.PROGRAMMES) {
    const s = T.programmeSummary(p.key);
    assert.ok(s.about && s.about.length > 40, p.name + ' needs an about line');
    assert.ok(s.setting, p.name + ' needs a setting');
  }
});

test('starting a programme from Train saves it running and asks which days', () => {
  const db = emptyAccount();
  const ui = mount(A.TrainTab, { db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {} });
  try {
    ui.click('Upper / lower');
    ui.clickEl(ui.findEl('Start this programme'));
    ui.clickEl(ui.findEl('Start 4 weeks'));
    const live = db.training.blocks.filter(b => !b.archived);
    assert.equal(live.length, 1, 'one running block');
    assert.equal(live[0].sourceRef.name, 'mac5');
    assert.equal(live[0].startISO, A.Store.todayISO());
    assert.ok(ui.has('When do you train?'), 'straight to the days: ' + ui.text.slice(0, 200));
  } finally { ui.unmount(); }
});
