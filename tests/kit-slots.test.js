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

test('sharing or re-running a programme keeps its slots open for whoever starts it', () => {
  const b = T.programmeBlock('pplh5');
  T.fillSlot(b, 'flat_press', 'db_bench');
  const again = T.blockFromTemplate(T.templateOf(b), { shape: 'as-written', style: 'minmax', weeks: 4 });
  assert.equal(T.unfilledSlots(again).length, 7);
});

test('starting PPL Hybrid asks for the kit before the days, and the button says what is missing', () => {
  const db = accountWith(T.programmeBlock('qp5'));
  db.training.blocks = [];
  let live = db;
  const ui = mount(A.TrainTab, { db: live, update(fn) { fn(live); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {} });
  try {
    ui.click('PPL Hybrid');
    ui.click('Start this programme');
    assert.ok(ui.findEl('Next: your kit'), 'the start sheet says the kit comes next');
    ui.clickEl(ui.findEl('Next: your kit'));
    assert.ok(ui.has('Pick 7 more'), 'seven to pick: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Incline press') && ui.has('Upper · 2 × 6-10'), 'each slot named, with where it is');
    ui.clickEl(ui.host.querySelector('[aria-label="Incline press: not picked yet"]'));
    ui.clickEl(Array.from(ui.host.ownerDocument.querySelectorAll('[role="radio"]')).find(b => /Dumbbells/.test(b.textContent)));
    assert.ok(ui.has('Pick 6 more'));
    assert.equal(live.training.prefs.kit.incline_press, 'db_incline', 'remembered for next time');
    assert.equal(live.training.blocks[live.training.blocks.length - 1].sessions.find(s => s.name === 'Upper').exercises[0].exerciseId, 'db_incline');
  } finally { ui.unmount(); }
});
