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
      assert.ok(ui.has(p.name) && ui.has(p.type), p.name + ' says its name and what it is: ' + ui.text.slice(0, 300));
      assert.ok(ui.has('by ' + p.author), p.name + ' says whose it is');
    }
    ui.click('PPL Plus');
    assert.ok(ui.has('Legs B') && ui.has('Quad focus'), 'the preview lists the days and what each is for: ' + ui.text.slice(0, 300));
    assert.ok(ui.has('Pendulum squat or Back squat'), 'and says an either/or line is one');
    assert.ok(ui.has('4 × 8-12') || ui.has('4 × 8–12'), 'with the written set counts: ' + ui.text.slice(-600));
    ui.click('Start this programme');
    assert.ok(ui.findEl('Next: your days'), 'one question - when - before the days');
    ui.clickEl(ui.findEl('Next: your days'));
    assert.deepEqual(picked, ['qp5', A.Store.todayISO()], 'starting it hands over the programme and the day');
    assert.equal(custom, null);
  } finally { ui.unmount(); }
});

test('the filters narrow the grid and All brings everything back', () => {
  const ui = mount(A.ProgrammeGallery, { db: emptyAccount(), onStart() {}, onCustomise() {} });
  try {
    ui.click('4 days');
    assert.ok(ui.has('Express Four'));
    assert.ok(!ui.has('Foundation Five'), 'five-day plans are filtered out');
    ui.click('Machines');
    assert.ok(ui.has('Machine Shop') && !ui.has('Express Four'));
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
    ui.click('Foundation Five');
    ui.clickEl(ui.findEl('Start this programme'));
    ui.clickEl(ui.findEl('Next: your days'));
    const live = db.training.blocks.filter(b => !b.archived);
    assert.equal(live.length, 1, 'one running block');
    assert.equal(live[0].sourceRef.name, 'mac5');
    assert.equal(live[0].startISO, A.Store.todayISO());
    assert.ok(ui.has('Which days?'), 'straight to the days: ' + ui.text.slice(0, 200));
  } finally { ui.unmount(); }
});

test('a movement page leads with its best numbers and how to do it, with dates written out', () => {
  const { render } = require('./helpers/app.js');
  const db = accountWith(T.programmeBlock('qp5', { startISO: A.Store.todayISO() }));
  db.training.logs = [{
    id: 'x1', dateISO: '2026-03-05', blockId: null, sessionId: null, name: 'Legs A',
    startedAt: '2026-03-05T10:00:00Z', endedAt: '2026-03-05T11:00:00Z',
    sets: [{ exerciseId: 'seated_leg_curl', setIndex: 0, type: 'work', weightKg: 40, reps: 12, rir: 0, done: true }],
  }];
  const r = render(A.ExerciseDetail, { db, update() {}, showToast() {}, exerciseId: 'seated_leg_curl', onBack() {}, onMerged() {} });
  assert.ok(r.has('Best est. 1RM') && r.has('Best set'), 'the records: ' + r.text.slice(0, 300));
  assert.ok(r.has('How to do it') && r.has('stretch-biased curl'), 'and the form cue');
  assert.ok(r.has('5 Mar') && !r.has('2026-03-05'), 'a written date, never a raw ISO one');
});
