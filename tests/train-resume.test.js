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
    // Dated with the session it belongs to: a log from Tuesday was started on Tuesday, and the
    // midnight-carry rule reads this to decide whether a session is still going.
    startedAt: o.startedAt || new Date(Date.parse((o.dateISO || A.Store.todayISO()) + 'T00:30:00Z')).toISOString(),
    endedAt: o.endedAt || null, sets: sets,
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
    // The clock lives in the More sheet now rather than in the header, so this has to open the
    // sheet to be worth anything: a session being corrected reports the day, never an hour counted
    // from the moment you opened it.
    ui.click('More');
    assert.ok(ui.has('Session · editing'), 'the sheet says editing: ' + ui.text.slice(0, 200));
    assert.ok(!/elapsed/.test(ui.text), 'and does not run a clock on a session that finished days ago');
    ui.click('Session notes');
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

// ---- 5. the session runner's own instruments ----------------------------------------------------

test('the spine draws one cell per movement, and the gold one is the movement you are on', () => {
  // It used to group its cells by movement AND paint the whole current movement gold, so a session
  // with nothing logged opened with two gold cells above the words "0 / 16 sets": the bar reading
  // started and the count reading not started, on the same line.
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const planned = (session.exercises || []).slice().sort((a, b) => a.order - b.order);
  // Everything up to a movement finished, and one set into that one - so the bar has a full cell, a
  // part-filled cell and an untouched one in it, which is the whole picture it is meant to draw.
  const partIdx = planned.findIndex((e, i) => i > 0 && (e.target.sets || 2) > 1);
  assert.ok(partIdx > 0, 'the fixture needs a multi-set movement to be part-way through');
  const sets = [];
  planned.forEach((e, mi) => {
    for (let si = 0; si < (e.target.sets || 2); si++) {
      const done = mi < partIdx || (mi === partIdx && si === 0);
      sets.push({ exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work',
        weightKg: done ? 60 : 0, reps: done ? 8 : null, done: done });
    }
  });
  db.training.logs = [Object.assign(logFor(session, { blockId: block.id }), { sets: sets })];
  const ui = mount(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    const cells = Array.from(ui.host.querySelectorAll('i')).filter(el => (el.getAttribute('style') || '').indexOf('height: 10px') !== -1);
    assert.equal(cells.length, planned.length, 'one cell per movement of the session, not per set');
    const bg = (el) => (el.getAttribute('style').match(/background:\s*([^;]+)/) || [])[1] || '';
    assert.ok(bg(cells[0]).indexOf('--good') !== -1 && bg(cells[0]).indexOf('gradient') === -1,
      'a finished movement is solid green: ' + bg(cells[0]));
    // The one being trained is gold, and part-filled with the set already ticked inside it.
    const part = cells[partIdx], ahead = cells[cells.length - 1];
    assert.ok(bg(part).indexOf('--accent') !== -1, 'the movement you are on is gold: ' + bg(part));
    assert.ok(bg(part).indexOf('gradient') !== -1 && bg(part).indexOf('--good') !== -1,
      'and shows how far into it you are: ' + bg(part));
    assert.equal(cells.filter(el => bg(el).indexOf('--accent') !== -1).length, 1, 'exactly one is gold');
    assert.ok(bg(ahead).indexOf('--track') !== -1 && bg(ahead).indexOf('--good') === -1,
      'and one you have not reached is empty');
    assert.ok(ui.has(partIdx + ' / ' + planned.length + ' done'), 'the count counts the same things the cells draw: ' + ui.text.slice(0, 120));
  } finally { ui.unmount(); }
});

test('the set count is not said twice on the same screen', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const ui = mount(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    assert.ok(!/sets logged so far/.test(ui.text),
      'the spine says it, permanently and in view, so the foot of the page does not repeat it');
  } finally { ui.unmount(); }
});

test('a movement you have never trained does not offer a dead History button', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const ui = mount(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    assert.ok(!ui.has('History'), 'nothing to show, so no greyed-out third button');
    assert.ok(ui.has('Note'), 'the two that do something are still there');
    assert.ok(ui.has('More'));
  } finally { ui.unmount(); }
});

test('every set ticked puts finishing in front of you', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const sets = [];
  (session.exercises || []).forEach(e => {
    for (let si = 0; si < (e.target.sets || 2); si++) {
      sets.push({ exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work', weightKg: 60, reps: 8, done: true });
    }
  });
  db.training.logs = [Object.assign(logFor(session, { blockId: block.id }), { sets: sets })];
  const ui = mount(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    assert.ok(ui.has('That is every set'), 'the one thing left to do is on screen: ' + ui.text.slice(-200));
    assert.ok(ui.has('All ') && /All \d+ sets logged/.test(ui.text),
      'and a finished movement does not claim to have a set outstanding');
  } finally { ui.unmount(); }
});

/* The runner announces focus mode, and takes it back on the way out.
 *
 * `App` hangs two things off this one flag: the tab bar steps aside for a session, and so does the
 * brand header (`{!focusMode && <MobileHeader/>}`). Both of those are the session getting the screen
 * to itself for an hour. Neither is testable from here - App needs a session and a store - but the
 * signal they both read is, and a signal that stopped firing, or stopped clearing, would leave
 * somebody stranded on a screen with no navigation at all.
 */
test('a running session asks for the screen, and gives it back', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const seen = [];
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {},
    sessionId: session.id, blockId: block.id, onExit() {}, onFocusMode(on) { seen.push(on); },
  });
  assert.deepEqual(seen, [true], 'the session takes the screen as it opens: ' + JSON.stringify(seen));
  ui.unmount();
  assert.deepEqual(seen, [true, false], 'and hands the chrome back when it closes: ' + JSON.stringify(seen));
});
