'use strict';
// Pick your kit (design-plans/39): a general programme line is a slot the person fills before the
// first session, remembered for the next programme that asks.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;

test('PPL Hybrid starts with its seven general lines unanswered', () => {
  const b = T.programmeBlock('pplh5');
  assert.deepEqual(T.unfilledSlots(b).map(x => x.key).sort(),
    ['cable_extension', 'flat_press', 'incline_press', 'lateral_raise', 'shoulder_press', 'shrugs', 'supinated_curl']);
  assert.ok(T.programmeHasSlots('pplh5'));
  assert.ok(!T.programmeHasSlots('qp5'), 'a programme that names real movements has none');
  // The placeholder shares the slot's muscles, so the plan's volume does not depend on the pick.
  const v0 = T.plannedVolume(T.weekSessions(b, 1), []);
  T.fillSlot(b, 'flat_press', 'db_bench');
  assert.deepEqual(T.plannedVolume(T.weekSessions(b, 1), []).ch, v0.ch);
});

test('a slot is filled everywhere from a week on, and the weeks before keep what was lifted', () => {
  const b = T.programmeBlock('pplh5');
  T.fillSlot(b, 'shrugs', 'shrug_machine');
  T.fillSlot(b, 'shrugs', 'shrug_bb', { fromWeek: 3 });
  const at = (w) => T.weekSessions(b, w).find(s => s.name === 'Pull').exercises.find(e => e.sourceName === 'Shrugs');
  assert.equal(at(2).exerciseId, 'shrug_machine');
  assert.equal(at(3).exerciseId, 'shrug_bb');
  assert.equal(at(3).baseExerciseId, undefined, 'a pick is not "instead of" anything');
});

test('what you picked before fills in, and a gym with one option answers that slot itself', () => {
  const b = T.programmeBlock('pplh5', { kit: { flat_press: 'db_bench', shrugs: 'shrug_bb' } });
  const rows = T.blockSlots(b);
  assert.equal(rows.find(r => r.key === 'flat_press').by, 'memory');
  assert.equal(T.unfilledSlots(b).length, 5);
  const gym = { id: 'g', name: 'Home', type: 'custom', equipment: ['dumbbell', 'bodyweight'] };
  const g = T.programmeBlock('pplh5', { gym });
  const lat = T.blockSlots(g).find(r => r.key === 'lateral_raise');
  assert.equal(lat.by, 'gym', 'dumbbells are the only lateral raise here');
  assert.equal(lat.exerciseId, 'db_lateral');
});

test('a PPL Hybrid started before slots existed is never asked again', () => {
  const b = T.programmeBlock('pplh5');
  b.sessions.forEach(s => s.exercises.forEach(e => { delete e.slot; }));
  assert.equal(T.unfilledSlots(b).length, 0);
  assert.equal(T.blockSlots(b).length, 7, 'but its lines are still known as slots, so they can be changed');
});

test('re-running a programme brings back last time\'s picks; sharing it does not', () => {
  const b = T.programmeBlock('pplh5');
  T.fillSlot(b, 'flat_press', 'db_bench');
  const again = T.blockFromTemplate(T.templateOf(b), { shape: 'as-written', style: 'minmax', weeks: 4 });
  const flat = T.blockSlots(again).find(r => r.key === 'flat_press');
  assert.deepEqual([flat.answered, flat.by, flat.exerciseId], [true, 'last', 'db_bench']);
  assert.equal(T.unfilledSlots(again).length, 6, 'the ones never picked stay open');
  const shared = T.blockFromTemplate(T.templatePayload(b).days, { shape: 'as-written', style: 'minmax', weeks: 4 });
  assert.equal(T.unfilledSlots(shared).length, 7, 'whoever adopts it picks their own');
});

test('starting PPL Hybrid offers the kit before the days, and nothing has to be picked yet', () => {
  const db = accountWith(T.programmeBlock('qp5'));
  db.training.blocks = [];
  let live = db;
  const ui = mount(A.TrainTab, { db: live, update(fn) { fn(live); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {} });
  try {
    ui.click('PPL Hybrid');
    ui.click('Start this programme');
    ui.clickEl(ui.findEl('Next: your kit'));
    assert.ok(ui.has('7 to pick'), 'seven open: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Incline press') && ui.has('Upper · 2 × 6-10'), 'each slot named, with where it is');
    ui.clickEl(ui.host.querySelector('[aria-label="Incline press: not picked yet"]'));
    ui.clickEl(Array.from(ui.host.ownerDocument.querySelectorAll('[role="radio"]')).find(b => /Dumbbells/.test(b.textContent)));
    assert.ok(ui.has('6 to pick'));
    assert.equal(live.training.prefs.kit.incline_press, 'db_incline', 'remembered for next time');
    assert.ok(ui.has('The 6 you leave will be asked at the gym'), 'and the rest can wait for the gym');
    ui.clickEl(ui.findEl('Next: your days'));
    assert.ok(ui.has('Which days?'), 'nothing blocks the days');
  } finally { ui.unmount(); }
});

test('at the gym an unpicked line asks which kit, and the answer holds for the rest of the programme', () => {
  const block = T.programmeBlock('pplh5', { startISO: A.Store.todayISO() });
  let live = accountWith(block);
  live.training.blocks[0].startISO = A.Store.todayISO();
  const session = T.weekSessions(live.training.blocks[0], 1).find(s => s.name === 'Upper');
  const ui = mount(A.SessionPlayer, {
    db: live, showToast() {}, onExit() {}, onFinish() {}, onFocusMode() {},
    sessionId: session.id, blockId: block.id, update(fn) { fn(live); },
  });
  try {
    assert.ok(ui.has('What are you using?'), 'the first line asks: ' + ui.text.slice(0, 500));
    assert.ok(ui.has('The plan says incline press'));
    ui.clickEl(ui.findEl('Barbell'));
    assert.ok(!ui.has('What are you using?') || ui.has('Flat press'), 'answered');
    const b = live.training.blocks[0];
    for (let w = 1; w <= 4; w++) {
      const line = T.weekSessions(b, w).find(s => s.name === 'Upper').exercises.find(e => e.sourceName === 'Incline Press');
      assert.equal(line.exerciseId, 'bb_incline', 'week ' + w);
      assert.ok(line.slot.answered);
    }
    assert.equal(live.training.prefs.kit.incline_press, 'bb_incline');
  } finally { ui.unmount(); }
});
