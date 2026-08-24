'use strict';
/* A session, from the first tick to the last, across everything that interrupts one.
 *
 * The companion suite to train-resume.test.js. That one covers getting back INTO a session; this one
 * covers the seven faults the same audit listed and left alone the first time round: the engine
 * still counting an unfinished session as done, the tab losing your place, a merge dropping a
 * device's sets, Finish deleting what you had not ticked, a repeat hiding the attempt before it, a
 * session that crosses midnight splitting in two, and a rest timer that died with the screen.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, render, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;
const S = A.Store;
const today = () => S.todayISO();
const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const minmax = () => T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });

function logFor(session, opts) {
  const o = opts || {};
  const dateISO = o.dateISO || today();
  const e = (session.exercises || [])[0];
  return {
    id: o.id || 'log_' + session.id, dateISO: dateISO, blockId: o.blockId || null,
    sessionId: session.id, name: session.name,
    startedAt: o.startedAt || new Date(Date.parse(dateISO + 'T00:30:00Z')).toISOString(),
    endedAt: o.endedAt || null,
    sets: (o.sets || [0, 1]).map(si => ({
      exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work', weightKg: 60, reps: 8, done: true,
    })),
  };
}

// ---- A. the engine knows the difference between started and done --------------------------------

test('completion does not count a session you are still in', () => {
  const block = minmax();
  const week = T.weekSessions(block, 1);
  const open = logFor(week[0], { blockId: block.id });                                    // today, no endedAt
  const done = logFor(week[1], { blockId: block.id, endedAt: new Date().toISOString() });
  const comp = T.completion(block, [open, done], today());
  assert.equal(comp.done, 1, 'one finished session, not two');
  assert.equal(comp.open, 1, 'and one still open');
  assert.ok(comp.openBySession[week[0].id], 'named, so a screen can offer to carry on with it');
  assert.ok(comp.logBySession[week[0].id], 'and still reachable as the session\'s log');
});

test('with no day to judge against, nothing counts as open', () => {
  // Every date in the engine is passed in - it has no clock of its own - so a caller with no day to
  // hand gets the old behaviour rather than a guess.
  const block = minmax();
  const week = T.weekSessions(block, 1);
  const comp = T.completion(block, [logFor(week[0], { blockId: block.id })]);
  assert.equal(comp.done, 1);
  assert.equal(comp.open, 0);
});

test('the block review reads adherence off finished sessions', () => {
  const block = minmax();
  const week = T.weekSessions(block, 1);
  const logs = week.map((s, i) => logFor(s, {
    blockId: block.id, id: 'l' + i,
    dateISO: shift(today(), -i),
    endedAt: i === 0 ? null : new Date().toISOString(),   // the first one is still open
  }));
  const review = T.reviewBlock(block, logs, T.defaultTargets(), null, today());
  assert.equal(review.completion.done, week.length - 1, 'the open one is not adherence yet');
});

// ---- E. a session run twice ---------------------------------------------------------------------

test('a session logged twice is represented by the right one of the two', () => {
  const block = minmax();
  const session = T.weekSessions(block, 1)[0];
  const old = logFor(session, { id: 'old', blockId: block.id, dateISO: shift(today(), -7), endedAt: new Date().toISOString() });
  const fresh = logFor(session, { id: 'new', blockId: block.id, endedAt: new Date().toISOString() });
  // Deliberately out of order: array position used to decide this.
  assert.equal(T.completion(block, [fresh, old], today()).logBySession[session.id].id, 'new',
    'the most recent attempt represents the session');
  // An open one wins over a finished one whatever the dates say: it is the session you are in.
  const open = logFor(session, { id: 'live', blockId: block.id });
  assert.equal(T.completion(block, [open, fresh], today()).logBySession[session.id].id, 'live');
});

// ---- F. midnight ---------------------------------------------------------------------------------

test('a session that crosses midnight is still the session you are in', () => {
  const yesterday = shift(today(), -1);
  const startedLateLastNight = new Date(Date.now() - 40 * 60000).toISOString();
  const log = { id: 'x', dateISO: yesterday, startedAt: startedLateLastNight, endedAt: null, sets: [] };
  assert.ok(T.sessionOpen(log, today(), Date.now()), 'forty minutes ago is the same session');
  assert.ok(!T.sessionOpen(log, today()), 'but only with a clock to judge it by');
  const stale = { id: 'y', dateISO: yesterday, startedAt: new Date(Date.now() - 20 * 3600000).toISOString(), endedAt: null, sets: [] };
  assert.ok(!T.sessionOpen(stale, today(), Date.now()), 'yesterday afternoon is yesterday');
  const finished = { id: 'z', dateISO: today(), startedAt: startedLateLastNight, endedAt: new Date().toISOString(), sets: [] };
  assert.ok(!T.sessionOpen(finished, today(), Date.now()), 'and finished is finished');
});

test('carrying on after midnight writes to the same log, on the night it started', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const yesterday = shift(today(), -1);
  db.training.logs = [logFor(session, {
    blockId: block.id, dateISO: yesterday, startedAt: new Date(Date.now() - 30 * 60000).toISOString(),
  })];
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {},
    sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    assert.ok(!ui.has('Editing'), 'this is a session being run, not one being corrected afterwards');
    ui.click('Add set');
  } finally { ui.unmount(); }
  assert.equal(db.training.logs.length, 1, 'no second log for the far side of midnight');
  assert.equal(db.training.logs[0].dateISO, yesterday, 'and the work stays on the night it was done');
});

// ---- B. the tab keeps your place ----------------------------------------------------------------

/* "Am I in the session runner?", asked of the rendered text. It used to be the word "elapsed", which
   the runner's header no longer carries: the clock moved to the More sheet, because a spine reporting
   the same session better sat directly under it. The marker is the runner's own footer instead. The
   spine's "n / n done" is NOT usable here - the tab's home draws the same shape for the week. */
const IN_SESSION = /Add an exercise/;

test('the Train tab opens on the session that is still open', () => {
  // `{view === 'train' && <TrainTab/>}` unmounts this whole tab whenever you look at your macros,
  // and a reload does the same. The session pointer is what survives both.
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id })];
  db.training.open = { sessionId: session.id, blockId: block.id, logId: null, freeform: false, atISO: today() };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(IN_SESSION.test(ui.text), 'straight back into the session: ' + ui.text.slice(0, 200));
    assert.ok(ui.has('More'), 'the runner, not the preview');
  } finally { ui.unmount(); }
});

test('a pointer at something that is no longer there opens nothing', () => {
  const block = minmax();
  const db = accountWith(block);
  db.training.open = { sessionId: 'gone', blockId: block.id, logId: null, freeform: false, atISO: today() };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(ui.has('Train'), 'it lands at home rather than on a screen it cannot draw');
    assert.ok(!IN_SESSION.test(ui.text), 'and not in a session: ' + ui.text.slice(0, 200));
  } finally { ui.unmount(); }
  assert.ok(!db.training.open, 'the dead pointer is cleared on the way past');
});

/* ---- every day of the week is a control you can hit -------------------------------------------
   Which session you do today gets decided in the doorway of the gym: the rack is taken, you are
   stiff, you have forty minutes. The plan has always ALLOWED it - `next` is a suggestion - but the
   week was drawn as a line of prose, four names in muted grey inside 19px-tall targets, while the
   one day the app had chosen wore a full-width button. Every session in the shown week now has a
   chip of its own, whatever state it is in, and the day is on every one of them. */

const DAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function weekChips(ui, block, week) {
  const want = T.weekSessions(block, week).map(s => s.name.split(' - ')[0]);
  const got = [];
  ui.host.querySelectorAll('button[aria-label]').forEach(el => {
    const a = el.getAttribute('aria-label') || '';
    if (want.some(n => a.indexOf(n + ',') === 0) && DAYS_FULL.some(d => a.indexOf(d) !== -1)) got.push(a);
  });
  return got;
}

test('every session in the week is its own control, not just the next one', () => {
  const block = minmax();                                    // five days a week
  const db = accountWith(block);
  const week = T.weekSessions(block, 1);
  // Three of five already done, so the row has to carry done, next and not-yet at the same time.
  db.training.logs = week.slice(0, 3).map(s => logFor(s, { blockId: block.id, endedAt: new Date().toISOString() }));
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    const chips = weekChips(ui, block, 1);
    assert.equal(chips.length, week.length, 'one per session, not one for the next: ' + JSON.stringify(chips));
    assert.ok(chips.some(a => /, done$/.test(a)), 'a finished day says so: ' + JSON.stringify(chips));
    assert.ok(chips.some(a => /, up next$/.test(a)), 'and the recommended one is marked: ' + JSON.stringify(chips));
    // The day is on every chip - it is what you are choosing between.
    chips.forEach(a => assert.ok(DAYS_FULL.some(d => a.indexOf(d) !== -1), 'names its day: ' + a));
  } finally { ui.unmount(); }
});

test('a day that is not the next one opens that day', () => {
  const block = minmax();
  const db = accountWith(block);
  const week = T.weekSessions(block, 1);
  const other = week[2];                                     // not next, not done
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    // The day is the COLUMN now, not part of the chip's text: the week is seven cells headed M T W
    // T F S S, so a cell reads as its session's name under the letter of the day it falls on. What
    // has to stay true is that it is still that day's own control.
    ui.click(other.name.split(' - ')[0]);
    assert.ok(ui.has(other.name.split(' - ')[0]), 'lands on that session');
    assert.ok(ui.has('Start'), 'with the way to begin it: ' + ui.text.slice(0, 200));
  } finally { ui.unmount(); }
});

/* ---- stepping out is not ending ----------------------------------------------------------------
   Leaving the player used to DELETE the session pointer, which made walking out to check a macro
   byte-for-byte the same act as abandoning the workout - and because the pointer was gone, the tab
   had nothing to offer back. Worse, while the pointer WAS there the router pulled you straight into
   the player on every mount, so a live session made Train home unreachable. Two jobs, one control.
   Now: `onExit` steps out and marks the record, `onFinish` clears it, and the router only auto-opens
   a session you did not choose to leave. */

test('stepping out of a session keeps it open', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id })];
  db.training.open = { sessionId: session.id, blockId: block.id, logId: null, freeform: false, atISO: today() };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(IN_SESSION.test(ui.text), 'starts in the session');
    ui.click('Train');                                            // the session bar's way back
    assert.ok(!IN_SESSION.test(ui.text), 'and lands on the tab: ' + ui.text.slice(0, 200));
    assert.ok(db.training.open, 'the session is still open');
    assert.ok(db.training.open.steppedOut, 'and marked as one you left on purpose');
  } finally { ui.unmount(); }
});

test('a session you stepped out of does not drag you back in', () => {
  // The tab is unmounted every time you look at your macros. Coming back must land on the tab, or
  // the session is a room with the door locked - which is exactly what was reported.
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id })];
  db.training.open = { sessionId: session.id, blockId: block.id, logId: null, freeform: false, atISO: today(), steppedOut: true };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(!IN_SESSION.test(ui.text), 'the tab, not the runner: ' + ui.text.slice(0, 200));
    assert.ok(db.training.open, 'and the session is still there to go back to');
  } finally { ui.unmount(); }
});

test('carrying on with a session clears the mark', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id })];
  db.training.open = { sessionId: session.id, blockId: block.id, logId: null, freeform: false, atISO: today(), steppedOut: true };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    ui.click('Carry on with');
    assert.ok(IN_SESSION.test(ui.text), 'back in the runner: ' + ui.text.slice(0, 200));
    assert.ok(!db.training.open.steppedOut, 'and no longer marked as stepped out');
  } finally { ui.unmount(); }
});

test('yesterday\'s pointer is not today\'s session', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.open = { sessionId: session.id, blockId: block.id, logId: null, freeform: false, atISO: shift(today(), -1) };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(!IN_SESSION.test(ui.text), 'the app does not put you back into last night: ' + ui.text.slice(0, 200));
  } finally { ui.unmount(); }
});

/* ---- finished is finished ----------------------------------------------------------------------
   Finish stamps `endedAt` and then hands you the buddy's send-off, and the send-off is the last
   thing a lot of people see before the phone goes in a bag. The pointer used to be dropped only when
   that screen was dismissed, so an app killed on it - or reloaded by the OS, or handed the other
   device's copy of `open` by a sync - came back with a pointer at a session that was already over
   and opened the runner on it, every launch. Two ways out: the pointer goes with the same write that
   ends the session, and a pointer that survives anyway is checked against the log before it is
   trusted. */

test('finishing clears the pointer there and then, not when the send-off is dismissed', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id })];
  db.training.open = { sessionId: session.id, blockId: block.id, logId: null, freeform: false, atISO: today() };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(IN_SESSION.test(ui.text), 'starts in the session');
    ui.click('That is every set');
    ui.click('Finish');                                           // through the confirm
    assert.ok(db.training.logs[0].endedAt, 'the session is over');
    assert.ok(!db.training.open, 'and nothing is left saying you are still in one');
  } finally { ui.unmount(); }
});

test('a pointer at a session you already finished opens nothing', () => {
  // The state a killed send-off leaves behind: the log ended, the pointer still there.
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id, endedAt: new Date().toISOString() })];
  db.training.open = { sessionId: session.id, blockId: block.id, logId: null, freeform: false, atISO: today() };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(!IN_SESSION.test(ui.text), 'the tab, not the runner you already left: ' + ui.text.slice(0, 200));
    assert.ok(!/Still open/.test(ui.text), 'and nothing offers a finished session back');
  } finally { ui.unmount(); }
  assert.ok(!db.training.open, 'the spent pointer is swept on the way past');
});

test('a finished freeform session does not reopen itself either', () => {
  // Freeform has no session id to check against the block, so it used to pass every test the pointer
  // was given and put you into a brand new empty session on every launch.
  const block = minmax();
  const db = accountWith(block);
  db.training.logs = [Object.assign(logFor(T.weekSessions(block, 1)[0], { endedAt: new Date().toISOString() }),
    { id: 'ff', sessionId: null, name: 'Empty session' })];
  db.training.open = { sessionId: null, blockId: null, logId: null, freeform: true, atISO: today() };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(!IN_SESSION.test(ui.text), 'lands on the tab: ' + ui.text.slice(0, 200));
  } finally { ui.unmount(); }
  assert.ok(!db.training.open, 'and the pointer is gone');
});

test('a session still going is not swept by any of that', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [logFor(session, { blockId: block.id })];            // today, no endedAt
  db.training.open = { sessionId: session.id, blockId: block.id, logId: null, freeform: false, atISO: today() };
  const ui = mount(A.TrainTab, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {}, onFocusMode() {},
  });
  try {
    assert.ok(IN_SESSION.test(ui.text), 'straight back into it: ' + ui.text.slice(0, 200));
  } finally { ui.unmount(); }
  assert.ok(db.training.open, 'and the pointer is left where it is');
});

// ---- G. the rest clock --------------------------------------------------------------------------

test('a rest that was running is still running when the screen comes back', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const log = logFor(session, { blockId: block.id });
  db.training.logs = [log];
  db.training.restRun = { endsAt: Date.now() + 90000, seconds: 120, from: 'A · set 2 of 3', logId: log.id };
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {},
    sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    assert.ok(ui.has('Next: A · set 2 of 3'), 'the countdown is where you left it: ' + ui.text.slice(-300));
  } finally { ui.unmount(); }
});

test('a rest belonging to another session, or already run out, is ignored', () => {
  const block = minmax();
  const session = T.weekSessions(block, 1)[0];
  const build = (restRun) => {
    const db = accountWith(block);
    db.training.logs = [logFor(session, { blockId: block.id })];
    db.training.restRun = restRun;
    return db;
  };
  const spent = build({ endsAt: Date.now() - 1000, seconds: 120, from: 'A · set 2 of 3', logId: 'log_' + session.id });
  let ui = mount(A.SessionPlayer, { db: spent, update(fn) { fn(spent); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {} });
  try { assert.ok(!ui.has('Next: A · set 2 of 3'), 'a rest that finished while you were away is over'); } finally { ui.unmount(); }
  const elsewhere = build({ endsAt: Date.now() + 90000, seconds: 120, from: 'A · set 2 of 3', logId: 'some_other_session' });
  ui = mount(A.SessionPlayer, { db: elsewhere, update(fn) { fn(elsewhere); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {} });
  try { assert.ok(!ui.has('Next: A · set 2 of 3'), 'and one belonging to another session is not yours'); } finally { ui.unmount(); }
});

// ---- D. Finish keeps what you did not tick -------------------------------------------------------

test('finishing a session keeps the sets you did not tick', () => {
  // They used to be deleted, which made a forgotten tick - or an accidental Finish - unrecoverable.
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const e = session.exercises[0];
  const row = (si, done) => ({ exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work', weightKg: 60, reps: 8, done: done });
  db.training.logs = [Object.assign(logFor(session, { blockId: block.id }), { sets: [row(0, true), row(1, false)] })];
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {},
    sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    ui.click('More');
    ui.click('Finish the session');
    assert.ok(ui.has('stays on the session, unticked'), 'and the dialog says so: ' + ui.text.slice(0, 300));
    ui.click('Finish');
  } finally { ui.unmount(); }
  const log = db.training.logs[0];
  assert.ok(log && log.endedAt, 'the session is finished');
  assert.equal(log.sets.length, 2, 'and both rows are still there, not just the ticked one');
  assert.equal(log.sets.filter(x => x.done).length, 1, 'with only one of them counting');
});

test('a finished session with nothing ticked is still thrown away', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  db.training.logs = [Object.assign(logFor(session, { blockId: block.id }), {
    sets: [{ exerciseId: 'bb_bench', itemId: 'i1', setIndex: 0, type: 'work', weightKg: 0, reps: null, done: false }],
  })];
  db.deleted = {};
  const ui = mount(A.SessionPlayer, {
    db, update(fn) { fn(db); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {},
  });
  try {
    ui.click('More').click('Finish the session').click('Finish');
  } finally { ui.unmount(); }
  assert.equal(db.training.logs.length, 0, 'nothing ticked, nothing kept');
  assert.ok(Object.keys(db.deleted || {}).length, 'and tombstoned, so a sync cannot hand it back');
});

// ---- C. two devices, one session ----------------------------------------------------------------

test('a session logged on two devices keeps both devices\' sets', () => {
  const setRow = (si, done) => ({ exerciseId: 'bb_bench', itemId: 'i1', setIndex: si, type: 'work', weightKg: 60, reps: 8, done: done });
  const phone = {
    _rev: 100,
    training: { blocks: [], custom: [], logs: [{ id: 'sess', dateISO: today(), sets: [setRow(0, true), setRow(1, true)] }] },
  };
  const laptop = {
    _rev: 9000,
    training: { blocks: [], custom: [], logs: [{ id: 'sess', dateISO: today(), endedAt: new Date().toISOString(), sets: [setRow(0, true), setRow(2, true)] }] },
  };
  const m = S.mergeStates(phone, laptop);
  const log = m.training.logs.filter(l => l.id === 'sess')[0];
  assert.ok(log, 'the session survives');
  // join() rather than deepStrictEqual: the merged arrays come out of the app's own realm, and
  // deepStrictEqual compares prototypes across it.
  assert.equal(log.sets.map(s => s.setIndex).sort().join(','), '0,1,2', 'every set from both copies');
  assert.ok(log.endedAt, 'and a session finished on either device is finished');
});

test('the same set edited on two devices takes the later edit', () => {
  const row = (w) => ({ exerciseId: 'bb_bench', itemId: 'i1', setIndex: 0, type: 'work', weightKg: w, reps: 8, done: true });
  const stale = { _rev: 100, training: { blocks: [], custom: [], logs: [{ id: 'sess', dateISO: today(), sets: [row(60)] }] } };
  const later = { _rev: 9000, training: { blocks: [], custom: [], logs: [{ id: 'sess', dateISO: today(), sets: [row(80)] }] } };
  const m = S.mergeStates(stale, later);
  const log = m.training.logs.filter(l => l.id === 'sess')[0];
  assert.equal(log.sets.length, 1, 'one set, not two');
  assert.equal(log.sets[0].weightKg, 80, 'and the correction wins over the typo');
});

test('a deleted session still stays deleted through the set-level merge', () => {
  const phone = {
    _rev: 100, deleted: {},
    training: { blocks: [], custom: [], logs: [{ id: 'sess', dateISO: today(), sets: [{ exerciseId: 'bb_bench', setIndex: 0, done: true }] }] },
  };
  const laptop = { _rev: 9000, deleted: { sess: Date.now() }, training: { blocks: [], custom: [], logs: [] } };
  const m = S.mergeStates(phone, laptop);
  assert.equal(m.training.logs.length, 0, 'a tombstone still beats a union');
});
