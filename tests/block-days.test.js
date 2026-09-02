'use strict';
/* Changing how many days a week a block runs, after it has been built.
 *
 * The day count was the one answer the build wizard asked that nothing afterwards could change, so
 * "I can train five days now, not four" meant building the block again from nothing. These are the
 * guarantees that make changing it in place safe: that the days you already have survive it
 * untouched, that what arrives and what leaves is named, that a running block keeps every log
 * pointing at it, and that a week already trained is out of reach.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

const four = () => T.generateBlock({ daysPerWeek: 4, weeks: 4 });
const names = (block, week) => T.weekSessions(block, week).slice()
  .sort((a, b) => a.dayOfWeek - b.dayOfWeek).map(s => s.name);
const moves = (block, week, day) => {
  const s = T.weekSessions(block, week).filter(x => x.name === day)[0];
  return T.sessionItems(s).map(e => e.exerciseId + ':' + e.target.sets);
};

test('going up adds a day and leaves the ones you had alone', () => {
  const b = four();
  const was = names(b, 1);
  const kept = was.map(d => moves(b, 1, d));
  const r = T.setDaysPerWeek(b, 5, {});
  assert.equal(r.changed, true);
  assert.equal(r.days, 5);
  assert.equal(r.block.daysPerWeek, 5);
  assert.equal(r.added.length, 1, 'one day arrived: ' + r.added.join(', '));
  assert.deepEqual(r.removed, []);
  // Every day that was there is still there, with the same movements and the same sets on them.
  was.forEach((d, i) => assert.deepEqual(moves(r.block, 1, d), kept[i], d + ' was rewritten'));
  assert.deepEqual(names(r.block, 1).slice(0, 4), was);
  // And it is the whole block, not week one.
  for (let w = 1; w <= b.weeks; w++) assert.equal(T.weekSessions(r.block, w).length, 5, 'week ' + w);
});

test('the day it adds is the kind of day the week has least of', () => {
  // Four days of upper/lower going to six: the week is short of push, pull and legs days, not of a
  // fifth upper. Adding the split's trailing days would have handed it another lower.
  const r = T.setDaysPerWeek(four(), 6, {});
  const kinds = T.weekSessions(r.block, 1).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek).map(s => s.kind);
  assert.equal(kinds.filter(k => k === 'upper').length, 2, 'the upper days it had');
  assert.equal(kinds.filter(k => k === 'lower').length, 2, 'the lower days it had');
  assert.equal(kinds.length, 6);
  assert.ok(kinds.filter(k => ['push', 'pull', 'legs', 'full', 'arms'].indexOf(k) !== -1).length === 2,
    'the two that arrived are days it had not got: ' + kinds.join(', '));
});

test('no two days end up with the same name, or the same ids', () => {
  const r = T.setDaysPerWeek(four(), 6, {});
  const day = names(r.block, 1);
  assert.equal(new Set(day).size, day.length, 'duplicate day names: ' + day.join(', '));
  const sids = r.block.sessions.map(s => s.id);
  assert.equal(new Set(sids).size, sids.length, 'duplicate session ids');
  const iids = r.block.sessions.reduce((a, s) => a.concat(s.exercises.map(e => e.id)), []);
  assert.equal(new Set(iids).size, iids.length, 'duplicate line ids');
});

test('going down takes days off the end of the week and says which', () => {
  const b = four();
  const was = names(b, 1);
  const r = T.setDaysPerWeek(b, 3, {});
  assert.deepEqual(r.removed, [was[3]]);
  assert.deepEqual(names(r.block, 1), was.slice(0, 3));
  assert.equal(r.block.daysPerWeek, 3);
  for (let w = 1; w <= b.weeks; w++) assert.equal(T.weekSessions(r.block, w).length, 3, 'week ' + w);
});

test('the block is still the same block, so a log still points at it', () => {
  const b = four();
  const first = T.weekSessions(b, 1).slice().sort((x, y) => x.dayOfWeek - y.dayOfWeek)[0];
  const r = T.setDaysPerWeek(b, 5, {});
  assert.equal(r.block.id, b.id, 'a new block id would orphan every log');
  assert.ok(r.block.sessions.some(s => s.id === first.id), 'the session a log names is still there');
  assert.equal(r.block.name, b.name);
  assert.equal(r.block.weeks, b.weeks);
  assert.equal(r.block.shape, b.shape);
});

test('a week already trained is left exactly as it was', () => {
  const b = four();
  const before = JSON.parse(JSON.stringify(T.weekSessions(b, 1)));
  const r = T.setDaysPerWeek(b, 6, { fromWeek: 3 });
  assert.equal(T.weekSessions(r.block, 1).length, 4, 'week 1 was trained at four days');
  assert.equal(T.weekSessions(r.block, 2).length, 4, 'and so was week 2');
  assert.equal(T.weekSessions(r.block, 3).length, 6, 'the change starts at the week you are on');
  assert.equal(T.weekSessions(r.block, 4).length, 6);
  assert.deepEqual(T.weekSessions(r.block, 1), before, 'week 1 is a record, not a plan to edit');
});

test('min-max re-lays its week, because the rest days are the method', () => {
  const b = T.generateBlock({ style: 'minmax', shape: 'minmax4', weeks: 4, daysPerWeek: 4 });
  const r = T.setDaysPerWeek(b, 5, {});
  const dows = T.weekSessions(r.block, 1).map(s => s.dayOfWeek).sort((x, y) => x - y);
  assert.deepEqual(dows, T.recommendedDows(b, 5).slice().sort((x, y) => x - y));
});

test('a week we do not prescribe keeps the weekdays you gave it', () => {
  const b = four();
  T.weekSessions(b, 1).forEach(s => { /* the block as generated */ });
  // Move everything to the weekend end of the week, as somebody with an awkward shift pattern would.
  b.sessions.forEach(s => { s.dayOfWeek = (s.dayOfWeek + 2) % 7; });
  const was = {};
  T.weekSessions(b, 1).forEach(s => { was[s.name] = s.dayOfWeek; });
  const r = T.setDaysPerWeek(b, 5, {});
  T.weekSessions(r.block, 1).forEach(s => {
    if (was[s.name] != null) assert.equal(s.dayOfWeek, was[s.name], s.name + ' was moved');
  });
  const dows = T.weekSessions(r.block, 1).map(s => s.dayOfWeek);
  assert.equal(new Set(dows).size, dows.length, 'the new day landed on a free weekday');
});

test('it clamps to what the app can build, and does nothing when nothing changed', () => {
  const b = four();
  assert.equal(T.setDaysPerWeek(b, 4, {}).changed, false);
  assert.equal(T.setDaysPerWeek(b, 4, {}).block.daysPerWeek, 4);
  assert.equal(T.setDaysPerWeek(b, 9, {}).days, 6);
  assert.equal(T.setDaysPerWeek(b, 1, {}).days, 2);
  assert.equal(T.setDaysPerWeek(b, 'nonsense', {}).changed, false);
});

test('an imported plan can change its day count too', () => {
  const b = T.programmeBlock('mac5', {});
  const r = T.setDaysPerWeek(b, 3, {});
  assert.equal(r.days, 3);
  assert.equal(r.removed.length, 2);
  assert.equal(T.weekSessions(r.block, 1).length, 3);
  assert.equal(r.block.name, b.name, 'it is still their programme, at three days');
});

/* ---- the control itself -----------------------------------------------------------------------
 * The engine half is above. This is that the answer is reachable: on the screen somebody is looking
 * at when they realise their week has changed, doing what it says, and reversible.
 */
const { app, mount, accountWith } = require('./helpers/app.js');
const A = app();

function builder() {
  const block = A.Training.generateBlock({ daysPerWeek: 4, weeks: 4 });
  block.startISO = null;
  const db = accountWith(block);
  db.training.blocks = [block];
  return mount(A.BlockBuilder, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {},
    blockId: block.id, onBack() {}, onStart() {}, onSchedule() {},
  });
}
// The day count buttons are a bare "5" among a screen full of numbers, so they are found by the
// control they sit in rather than by their words.
function pressDays(ui, n) {
  const card = Array.from(ui.host.querySelectorAll('div'))
    .filter(d => d.textContent.indexOf('Days a week') !== -1 && d.querySelectorAll('button').length >= 5)
    .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  assert.ok(card, 'the days control is on the screen: ' + ui.text.slice(0, 400));
  const el = Array.from(card.querySelectorAll('button')).filter(b => b.textContent.trim() === String(n))[0];
  assert.ok(el, 'there is a "' + n + '" to press');
  ui.clickEl(el);
}

test('the day count can be changed from the block screen', () => {
  const ui = builder();
  try {
    assert.ok(ui.has('Days a week'), 'the control is there: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('4 sessions in week 1'), 'and says where it stands: ' + ui.text.slice(0, 400));
    pressDays(ui, 6);
    assert.ok(ui.has('6 sessions in week 1'), 'six days now: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Added '), 'and it names what arrived: ' + ui.text.slice(0, 600));
    ui.click('Put it back to 4 days');
    assert.ok(ui.has('4 sessions in week 1'), 'back where it was');
  } finally { ui.unmount(); }
});

test('dropping a day says which day went', () => {
  const ui = builder();
  try {
    pressDays(ui, 3);
    assert.ok(ui.has('3 sessions in week 1'), 'three days now: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Took out '), 'and it names what left: ' + ui.text.slice(0, 600));
  } finally { ui.unmount(); }
});

/* ---- and asked before anything is read ---------------------------------------------------------
 * `days` is not only a setting for the block we write. It is handed to the reader as which day-count
 * track to pull out of a source, and it is what a brought plan is laid across - so asking it AFTER
 * the upload step meant five screenshots of a five-day week were read at whatever the last block
 * happened to be. The question has to be in front of somebody before they tap "Choose file(s)".
 */
const { render } = require('./helpers/app.js');

function wizard() {
  const db = accountWith(A.Training.generateBlock({ daysPerWeek: 4, weeks: 4 }));
  db.training.blocks = [];
  return { db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, onBack() {}, onDraft() {}, onShots() {} };
}

test('the day count is asked on the step that reads your screenshots, above the upload', () => {
  const r = render(A.BlockWizard, wizard());
  assert.ok(/Days a week/.test(r.text), 'it is on the opening step: ' + r.text.slice(0, 300));
  assert.ok(/Bring a programme/.test(r.text), 'so is the import');
  assert.ok(r.text.indexOf('Days a week') < r.text.indexOf('Bring a programme'),
    'and it is answered first: ' + r.text.slice(0, 400));
  assert.ok(/How you want to train/.test(r.text), 'the style question is still first of all');
  assert.ok(r.text.indexOf('How you want to train') < r.text.indexOf('Days a week'),
    'style before days, since the style is what moves the default');
});

test('the import says it reads at that count, and follows a plan that brought its own', () => {
  const r = render(A.BlockWizard, wizard());
  assert.ok(/day count set above/.test(r.text), 'it points at the control, which is above it now');
  assert.ok(/the count follows it/.test(r.text), 'and says an untouched count follows the source');
});

test('the day count is asked once, and the sessions step says where it stands', () => {
  const ui = mount(A.BlockWizard, wizard());
  try {
    const asks = (ui.text.match(/Days a week/g) || []).length;
    assert.equal(asks, 1, 'one control, not two that can disagree');
    pressDays(ui, 5);
    ui.click('Next · Sessions');
    assert.ok(ui.has('5 sessions a week'), 'the next step carries the answer: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Change it'), 'and says where to change it rather than asking again');
    ui.click('Change it');
    assert.ok(ui.has('Bring a programme'), 'which goes back to the step it is on');
  } finally { ui.unmount(); }
});

/* ---- the five-day bodybuilding split ------------------------------------------------------------
 * Transcribed from five screenshots of the app it was written in, which is a worse source than a
 * spreadsheet and so needs its own guard: that what ships is what those screenshots say, movement
 * for movement, set for set and rep for rep. The transcription is by hand; this is the check on it.
 */
const bb5 = () => A.Training.programmeOf('bb5');
const day = (name) => bb5().template.filter(d => d.name === name)[0];
const said = (name) => day(name).exercises.map(e => e.sourceName + ' ' + e.target.sets + 'x' + e.target.repLow + ' @' + e.target.tempo);

test('the five-day bodybuilding split ships as its author wrote it', () => {
  assert.equal(bb5().name, 'Macrosaurus 5 Day Bodybuilding');
  assert.equal(bb5().daysPerWeek, 5);
  assert.deepEqual(bb5().template.map(d => d.name), ['Upper 1', 'Lower 1', 'Arms and delts', 'Upper 2', 'Lower 2']);
  assert.deepEqual(said('Upper 1'), [
    'Smith Machine Incline Press 2x6 @2110',
    'Machine Lat Pulldown 2x8 @2110',
    'Decline Chest Fly 2x8 @2110',
    'T-Bar Row (Mega Mass) 2x6 @2110',
    'T-Bar Row 1x8 @2110',
    'Hanging Leg Raises 2x8 @2110',
  ]);
  assert.deepEqual(said('Lower 1'), [
    'Pendulum Squat 2x8 @2110',
    'Split Squat Smith Machine 1x6 @2110',
    'Hamstring Curl 2x8 @2110',
    'Machine Adduction 2x8 @2110',
    'Leg Extensions 2x8 @2110',
  ]);
  assert.deepEqual(said('Arms and delts'), [
    'DB Seated Shoulder Press 2x8 @3110',
    'Machine Lateral Raise 2x10 @2110',
    'Machine Rear Delt Fly 1x10 @2110',
    'Alternating Dumbbell Hammer Curl 2x8 @2110',
    'French Press (OHTX) 2x6 @2110',
    'Machine Preacher Curl 2x6 @2110',
    'Cable Tricep Pushdown 2x8 @2110',
  ]);
  // The two repeat days are the same session, bar the movement each finishes on and one tempo -
  // which is exactly what the screenshots show, and the easiest thing to get wrong by hand.
  assert.deepEqual(said('Upper 2').slice(0, 5), said('Upper 1').slice(0, 5));
  assert.equal(said('Upper 2')[5], 'Machine Ab Crunch 2x8 @2110');
  assert.deepEqual(said('Lower 2').slice(1), said('Lower 1').slice(1));
  assert.equal(said('Lower 2')[0], 'Pendulum Squat 2x8 @3110');
});

test('every movement in it is a real one, resolved to what the plan actually asked for', () => {
  const T2 = A.Training;
  for (const d of bb5().template) {
    for (const e of d.exercises) {
      assert.ok(T2.byId(e.exerciseId), e.sourceName + ' points at nothing in the library');
      // The name as the plan writes it must resolve to the same movement the template hard-codes,
      // so importing this plan and running the shipped copy cannot disagree about what it is.
      assert.equal(T2.resolve(e.sourceName), e.exerciseId, e.sourceName + ' does not resolve to itself');
      assert.ok((e.alts || []).every(a => T2.byId(a)), e.sourceName + ' offers a substitution that does not exist');
    }
  }
});

test('it runs as written: four weeks that all prescribe the same thing', () => {
  const T2 = A.Training;
  const b = T2.programmeBlock('bb5', {});
  assert.equal(b.weeks, 4);
  assert.equal(b.shape, 'as-written');
  assert.equal(b.style, 'minmax');
  const sig = (w) => T2.weekSessions(b, w).map(s => T2.sessionItems(s)
    .map(e => [e.exerciseId, e.target.sets, e.target.repLow, e.target.repHigh, e.target.tempo].join('|')).join(',')).join('/');
  assert.equal(sig(4), sig(1), 'week 4 should prescribe exactly what week 1 does');
});

test('a rep count written as one number is read back as one number', () => {
  const T2 = A.Training;
  // The plan says eight reps, not eight to eight. Ten call sites used to render the pair raw.
  assert.equal(T2.repLabel({ repLow: 8, repHigh: 8 }), '8');
  assert.equal(T2.repLabel({ repLow: 6, repHigh: 8 }), '6-8');
  assert.equal(T2.repLabel({ repLow: 10, repHigh: null }), '10');
  assert.equal(T2.repLabel({}), '');
  const b = T2.programmeBlock('bb5', {});
  const db = accountWith(b);
  const s = T2.weekSessions(b, 1)[0];
  const r = render(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: s.id, blockId: b.id, onExit() {}, onFocusMode() {}, gym: null,
  });
  assert.ok(!/\b(\d+)-\1\b/.test(r.text), 'nothing should read "8-8": ' + (r.text.match(/[^ ]*\d-\d[^ ]*/) || [''])[0]);
});
