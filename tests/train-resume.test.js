'use strict';
/* Getting back INTO a session.
 *
 * Three reports from one account, all of them the same shape: the button that begins a session did
 * nothing, walking out of a session part-way looked like it had ended the whole thing, and a session
 * already logged could only be deleted. These are the regressions for the three.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, render, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;
const minmax = () => T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);

// A log against a session, as the player writes one: sets first, `endedAt` only once you finish.
function logFor(session, opts) {
  const o = opts || {};
  const sets = (session.exercises || []).slice(0, o.movements || 1).reduce((a, e, i) => a.concat(
    Array.from({ length: 2 }, (_, si) => ({
      exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work',
      weightKg: 60, reps: 8, rir: 1, done: true,
    }))), []);
  return {
    id: o.id || 'log_' + session.id, dateISO: o.dateISO || A.Store.todayISO(),
    blockId: o.blockId || null, sessionId: session.id, name: session.name,
    startedAt: new Date().toISOString(), endedAt: o.endedAt || null, sets: sets,
  };
}

// ---- 1. the button that starts a session -------------------------------------------------------

test('starting a session on an account with two gyms asks which one, from the preview screen', () => {
  // `startSession` puts the start on hold and waits for the answer. The picker that asks was
  // rendered beside the HOME screen only, so from the preview - which is where the button that
  // begins a session actually lives - the tap set some state and drew nothing. Nothing happened,
  // twice: "Start" and "Carry on with it" are the same call.
  const block = minmax();
  const db = accountWith(block);
  db.training.gyms = [
    { id: 'g1', name: 'Home', equipment: ['db'] },
    { id: 'g2', name: 'The gym', equipment: ['bb', 'db', 'machine'] },
  ];
  db.training.prefs.currentGymId = 'g1';
  const ui = mount(A.TrainTab, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    ui.click('Open ' + block.sessions[0].name.split(' - ')[0]);
    assert.ok(ui.has('movements'), 'the preview opened: ' + ui.text.slice(0, 200));
    ui.click('Start ' + block.sessions[0].name.split(' - ')[0]);
    assert.ok(ui.has('Where are you training?'),
      'the gym question has to be drawn on whatever screen asked it: ' + ui.text.slice(0, 300));
  } finally { ui.unmount(); }
});

test('one gym, or none, and the session starts without being asked anything', () => {
  const block = minmax();
  const db = accountWith(block);
  let started = null;
  const ui = mount(A.TrainTab, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {},
    onFocusMode(on) { if (on) started = true; },
  });
  try {
    ui.click('Open ' + block.sessions[0].name.split(' - ')[0]);
    ui.click('Start ' + block.sessions[0].name.split(' - ')[0]);
    assert.ok(!ui.has('Where are you training?'), 'nothing to choose between, so nothing to ask');
    assert.ok(started, 'it went straight into the session');
  } finally { ui.unmount(); }
});

// ---- 2. a session you walked out of ------------------------------------------------------------

test('a session started and not finished is still yours to carry on with', () => {
  // The log row is written on the first tick. Every reader treated the existence of one as "done",
  // so leaving mid-session ticked the day off, moved the week on and left no way back in.
  const block = minmax();
  const db = accountWith(block);
  const first = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(first, { blockId: block.id })];
  const r = render(A.TrainHome, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block, onOpen() {}, go() {},
  });
  assert.ok(r.has('In progress'), 'it says so: ' + r.text.slice(0, 400));
  assert.ok(r.has('is still open'), 'and says which one');
  assert.ok(r.has('Carry on with ' + first.name.split(' - ')[0]), 'and the button goes back into it');
  assert.ok(/You are 2 sets into this one/.test(r.text), 'with what is already saved: ' + r.text.slice(0, 500));
  // It is NOT one of the week's finished sessions.
  const total = T.weekSessions(block, 1).length;
  assert.ok(r.has(total + ' sessions left this week'), 'and the week has not ticked itself off: ' + r.text.slice(0, 300));
});

test('a finished session is done, and so is one left behind on an earlier day', () => {
  const block = minmax();
  const db = accountWith(block);
  const week = T.weekSessions(block, 1);
  db.training.logs = [
    logFor(week[0], { blockId: block.id, endedAt: new Date().toISOString() }),
    // No `endedAt`, but yesterday's. Logs written before the field existed have none either, and a
    // session you abandoned on Tuesday must not reopen itself every day for the rest of the week.
    logFor(week[1], { blockId: block.id, dateISO: shift(A.Store.todayISO(), -1) }),
  ];
  const r = render(A.TrainHome, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block, onOpen() {}, go() {},
  });
  assert.ok(!r.has('In progress'), 'nothing is open: ' + r.text.slice(0, 400));
  assert.ok(r.has((week.length - 2) + ' sessions left this week'), 'both count as done: ' + r.text.slice(0, 300));
});

test('the preview does not promise to pick up a session it would restart', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id, dateISO: shift(A.Store.todayISO(), -9), endedAt: new Date().toISOString() })];
  const r = render(A.SessionPreview, {
    db, update() {}, showToast() {}, session, block, onBack() {}, onStart() {},
  });
  assert.ok(r.has('logs a new session against today'), 'said plainly: ' + r.text.slice(0, 400));
  assert.ok(!r.has('Carry on with it'), 'because carrying on is not what that button would do');
});

// ---- 3. a session already logged ---------------------------------------------------------------

test('history opens a session rather than only offering to delete it', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id, dateISO: shift(A.Store.todayISO(), -5), endedAt: new Date().toISOString() })];
  let opened = null;
  const ui = mount(A.TrainHistory, {
    db, update() {}, onBack() {}, onOpenExercise() {}, onOpenSession(l) { opened = l; },
  });
  try {
    ui.click('Sessions');
    assert.ok(ui.has('Open & edit'), 'the way in is on the card: ' + ui.text.slice(0, 400));
    ui.click('Open & edit');
  } finally { ui.unmount(); }
  assert.ok(opened && opened.sessionId === session.id, 'and it hands over the log that was tapped');
});

test('a session opened from history is edited on its own day, not moved to today', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const then = shift(A.Store.todayISO(), -5);
  db.training.logs = [logFor(session, { blockId: block.id, dateISO: then, endedAt: new Date().toISOString() })];
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {},
    sessionId: session.id, blockId: block.id, openLogId: db.training.logs[0].id, onExit() {},
  });
  try {
    assert.ok(ui.has('Editing'), 'the screen says what it is: ' + ui.text.slice(0, 200));
    assert.ok(!/elapsed/.test(ui.text), 'and does not run a clock on a session that finished days ago');
    ui.click('Add set');
  } finally { ui.unmount(); }
  const out = db.training.logs.filter(l => l.sessionId === session.id);
  assert.equal(out.length, 1, 'the edit goes into the session that was opened, not a new one');
  assert.equal(out[0].dateISO, then, 'and it stays on the day the work was actually done');
});

// ---- 4. the session that is not in the plan -----------------------------------------------------

test('the empty-session link actually starts an empty session', () => {
  // It set a piece of component state that nothing rendered. Tapping it did nothing whatsoever,
  // which is the same symptom as the gym question and a different cause.
  const block = minmax();
  const db = accountWith(block);
  let freeform = false;
  const ui = mount(A.TrainHome, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block,
    onOpen() {}, onFreeform() { freeform = true; }, go() {},
  });
  try {
    ui.click('Empty session');
    assert.ok(ui.has('Start an empty session?'), 'it says what one is: ' + ui.text.slice(0, 300));
    ui.click('Start one');
  } finally { ui.unmount(); }
  assert.ok(freeform, 'and then starts one');
});

test('a second empty session in one day is its own session', () => {
  // Empty sessions have no plan to be "the same session" as, so the runner matched them on the date
  // alone: log a bit of arms at lunchtime, finish it, start something in the evening and you were
  // handed the lunchtime session back.
  const db = accountWith(minmax());
  db.training.logs = [{
    id: 'log_am', dateISO: A.Store.todayISO(), blockId: null, sessionId: null, name: 'Empty session',
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    sets: [{ exerciseId: 'db_curl', setIndex: 0, type: 'work', weightKg: 20, reps: 10, done: true }],
  }];
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {}, freeform: true, onExit() {},
  });
  try {
    assert.ok(!ui.has('Dumbbell curl'), 'the finished one is not reopened: ' + ui.text.slice(0, 300));
  } finally { ui.unmount(); }
});
