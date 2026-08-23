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
    // No tabs any more - History does one job, and the whole ROW is the way in rather than a button
    // on a card. What has to stay true is that a logged session can be reopened at all: it was once
    // a receipt with nothing but Delete under it, which is the regression this test exists for.
    assert.ok(ui.has(session.name.split(' - ')[0]), 'the session is listed: ' + ui.text.slice(0, 300));
    ui.click(session.name.split(' - ')[0]);
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
    // The count reads "N of M done" and lives in the title now rather than on the spine's right,
    // which is what gave the cells the full width of the bar. It still has to count MOVEMENTS, the
    // same things the cells draw, which is the part of this that is not cosmetic.
    assert.ok(ui.has(partIdx + ' of ' + planned.length + ' done'), 'the count counts the same things the cells draw: ' + ui.text.slice(0, 120));
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

// ---- the session runner, after the "tick-first" pass -------------------------------------------

// A session part-way through, plus a WEEK OF HISTORY behind it, which is what makes "last time" a
// real number rather than a null. `done` sets are what the movement did today.
function partWayAccount(opts) {
  const o = opts || {};
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 1)[0];
  const planned = (session.exercises || []).slice().sort((a, b) => a.order - b.order);
  const today = A.Store.todayISO();
  // Last week: every movement done at 60kg for 8, so every row has something to carry forward.
  const before = {
    id: 'log_prev', dateISO: shift(today, -7), blockId: block.id, sessionId: session.id,
    name: session.name, startedAt: shift(today, -7) + 'T09:00:00.000Z', endedAt: shift(today, -7) + 'T10:00:00.000Z',
    sets: planned.reduce((a, e) => a.concat(Array.from({ length: e.target.sets || 2 }, (_, si) => ({
      exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work',
      weightKg: 60, reps: 8, rir: 1, done: true,
    }))), []),
  };
  // Today: the movements named in `done` are finished, everything else is untouched and EMPTY -
  // which is what the effort-not-load rule leaves in the weight box.
  const doneIdx = o.done || [];
  const now = {
    id: 'log_live', dateISO: today, blockId: block.id, sessionId: session.id, name: session.name,
    startedAt: today + 'T09:00:00.000Z', endedAt: null,
    sets: planned.reduce((a, e, mi) => a.concat(Array.from({ length: e.target.sets || 2 }, (_, si) => ({
      exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work',
      weightKg: doneIdx.indexOf(mi) >= 0 ? 62.5 : 0,
      reps: doneIdx.indexOf(mi) >= 0 ? 8 : null,
      rir: doneIdx.indexOf(mi) >= 0 ? 1 : null,
      done: doneIdx.indexOf(mi) >= 0,
    }))), []),
  };
  db.training.logs = o.noHistory ? [now] : [before, now];
  return { db, block, session, planned };
}

function runner(fx, onWrite) {
  let live = fx.db;
  return mount(A.SessionPlayer, {
    db: live, showToast() {}, onExit() {}, onFinish() {}, onFocusMode() {},
    sessionId: fx.session.id, blockId: fx.block.id,
    update(fn) { fn(live); onWrite && onWrite(live); },
  });
}

test('resuming a session brings "last time" back with it', () => {
  // `lastTime` is worked out from your history when a session is first laid out, and it was not
  // rebuilt on the way back in - so every weight placeholder and every carry-forward vanished the
  // moment a phone locked itself between sets, which is the NORMAL way to be in a session.
  const fx = partWayAccount();
  const ui = runner(fx);
  try {
    const kg = Array.from(ui.host.querySelectorAll('input[inputmode="decimal"]'));
    assert.ok(kg.length, 'the runner drew its weight column');
    assert.ok(kg.some(el => el.getAttribute('placeholder') === '60'),
      'last week\'s 60kg is offered as the placeholder on a resumed session: '
      + JSON.stringify(kg.map(el => el.getAttribute('placeholder'))));
  } finally { ui.unmount(); }
});

test('a bare tick logs last time\'s weight, and never invents an RIR', () => {
  // The box opens empty under the effort-not-load rule, so a tick with nothing typed used to log a
  // set of NO weight: no tonnage, no e1RM, no record check. "The same as last time" is the one
  // honest thing to write there. Effort is not - it is the one number only the lifter has.
  const fx = partWayAccount();
  let wrote = null;
  const ui = runner(fx, (d) => { wrote = d; });
  try {
    const tick = Array.from(ui.host.querySelectorAll('button'))
      .filter(b => /^Mark set \d done$/.test(b.getAttribute('aria-label') || ''))[0];
    assert.ok(tick, 'there is an unticked set to press');
    ui.clickEl(tick);
    const log = wrote.training.logs.filter(l => l.id === 'log_live')[0];
    const first = log.sets.filter(s => s.done)[0];
    assert.equal(first.weightKg, 60, 'the weight came forward from last time');
    assert.ok(first.reps > 0, 'and the reps came from what was being asked for');
    assert.equal(first.rir, null, 'but the effort is left blank rather than assumed');
  } finally { ui.unmount(); }
});

test('with no history behind it, a bare tick leaves the weight alone', () => {
  // There is nothing honest to carry forward on a movement you have never done, and inventing one
  // is the thing this whole rule exists to stop.
  const fx = partWayAccount({ noHistory: true });
  let wrote = null;
  const ui = runner(fx, (d) => { wrote = d; });
  try {
    const tick = Array.from(ui.host.querySelectorAll('button'))
      .filter(b => /^Mark set \d done$/.test(b.getAttribute('aria-label') || ''))[0];
    ui.clickEl(tick);
    const log = wrote.training.logs.filter(l => l.id === 'log_live')[0];
    assert.equal(log.sets.filter(s => s.done)[0].weightKg, 0, 'no last time, no weight');
  } finally { ui.unmount(); }
});

test('the warm-up offer is made where a ramp would follow, and retires once it is taken', () => {
  // The ramp is worked out FROM the weight in set one, and set one opens empty, so the feature was
  // invisible to exactly the people who had never found it.
  const fx = partWayAccount();
  const ui = runner(fx);
  try {
    assert.ok(ui.has('Put it in set 1'), 'the offer is on the movement you are on: ' + ui.text.slice(0, 300));
  } finally { ui.unmount(); }

  const seen = partWayAccount();
  seen.db.training.prefs = Object.assign({}, seen.db.training.prefs, { sawWarmupHint: true });
  const ui2 = runner(seen);
  try {
    assert.ok(!ui2.has('Put it in set 1'), 'and it is gone once you have typed a weight yourself');
  } finally { ui2.unmount(); }
});

test('finishing a movement moves you to the next one with work left, not the next one along', () => {
  // Sessions get done out of order - a rack is busy, so the accessory goes first - and advancing
  // blindly to ii + 1 landed you on a card of ticks you had already filled.
  const set = (done) => ({ sets: [{ done: done }, { done: done }] });
  const items = [set(true), set(true), set(false), set(false)];
  assert.equal(A.nextUnfinished(items, 0), 2, 'movement 1 is already done, so it is skipped');
  assert.equal(A.nextUnfinished(items, 2), 3, 'and the ordinary case still goes to the next one');
  // Out of order cuts both ways: finish the last thing first and everything left is ABOVE you.
  assert.equal(A.nextUnfinished([set(false), set(true), set(true)], 2), 0, 'it wraps to the start');
  // A part-finished movement is still work.
  assert.equal(A.nextUnfinished([set(true), { sets: [{ done: true }, { done: false }] }], 0), 1,
    'one set left is still one set left');
  // Nothing left anywhere is the end of the session, not a jump back to where you already are.
  assert.equal(A.nextUnfinished([set(true), set(true)], 0), -1, 'and it says so when there is nothing');
});

test('the receipt writes straight sets the way a lifter writes them', () => {
  const kg = (n) => n + 'kg';
  // The normal case is the one that was longest: four sets at one weight said the weight four times.
  assert.equal(
    A.setsSummary([{ weightKg: 62.5, reps: 10 }, { weightKg: 62.5, reps: 10 }, { weightKg: 62.5, reps: 9 }, { weightKg: 62.5, reps: 9 }], kg),
    '62.5kg × 10, 10, 9, 9');
  // A change of weight is the news, so it starts a new run rather than being folded away.
  assert.equal(
    A.setsSummary([{ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }, { weightKg: 45, reps: 12 }], kg),
    '60kg × 8, 8 · 45kg × 12');
  // Back UP to a weight already used is still a new run: the order is what happened.
  assert.equal(
    A.setsSummary([{ weightKg: 60, reps: 8 }, { weightKg: 45, reps: 12 }, { weightKg: 60, reps: 6 }], kg),
    '60kg × 8 · 45kg × 12 · 60kg × 6');
  // Bodyweight has no number to say, and a set ticked without reps must not read as zero reps.
  assert.equal(A.setsSummary([{ weightKg: 0, reps: 12 }, { weightKg: 0, reps: 10 }], kg), 'BW × 12, 10');
  assert.equal(A.setsSummary([{ weightKg: 0, reps: null }], kg), 'BW × –');
  assert.equal(A.setsSummary([], kg), '');
});

test('there is a way to finish whether or not every set is ticked', () => {
  // It used to appear only once everything was ticked, so the ordinary end of a session - the gym is
  // closing and two movements are still open - reached the bottom of the screen and found no way to
  // say it was over.
  const part = partWayAccount({ done: [0] });
  const ui = runner(part);
  try {
    assert.ok(ui.has('sets ticked'), 'the count is stated rather than a question asked: ' + ui.text.slice(-220));
    assert.ok(!ui.has('That is every set'), 'and the committing version is held back while work is open');
  } finally { ui.unmount(); }

  // Everything ticked is a different KIND of object: the thing you came to do, so it takes the gold.
  const all = partWayAccount({ done: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  const ui2 = runner(all);
  try {
    assert.ok(ui2.has('That is every set'), 'every set in gets the committing button: ' + ui2.text.slice(-220));
  } finally { ui2.unmount(); }
});

// ---- choosing which days you train -------------------------------------------------------------

test('setting your training days on the screen moves every week of the block', () => {
  const block = T.generateBlock({
    daysPerWeek: 4, weeks: 4, shape: 'build4',
    targets: T.defaultTargets({ experience: 'intermediate' }), name: 'X', startISO: '2026-08-17',
  });
  const db = accountWith(block);
  let live = db;
  const ui = mount(A.ScheduleDays, {
    db: live, showToast() {}, isPremium: true, onUpgrade() {}, block, onBack() {},
    update(fn) { fn(live); },
  });
  try {
    assert.ok(ui.has('Upper A'), 'every session of the week is listed: ' + ui.text.slice(0, 200));
    // Nothing to commit until something changes - the default is already what the block runs.
    assert.ok(ui.has('Nothing to change'), 'and it opens with nothing to save');
    const sat = Array.from(ui.host.querySelectorAll('button'))
      .filter(b => /Upper A on Saturday/.test(b.getAttribute('aria-label') || ''))[0];
    assert.ok(sat, 'each session offers all seven days');
    ui.clickEl(sat);
    ui.click('Save these days');
    for (let w = 1; w <= 4; w++) {
      const first = live.training.blocks[0].sessions.filter(s => s.week === w)[0];
      assert.equal(first.dayOfWeek, 5, 'week ' + w + ' moved to Saturday');
    }
  } finally { ui.unmount(); }
});

test('a brand new block asks which days before it hands you the plan', () => {
  // The default week is a good guess and still only a guess about somebody's Tuesdays. The moment it
  // is cheapest to correct is before the first session has been run against it.
  const block = T.generateBlock({
    daysPerWeek: 4, weeks: 4, shape: 'build4',
    targets: T.defaultTargets({ experience: 'intermediate' }), name: 'X', startISO: '2026-08-17',
  });
  const db = accountWith(block);
  const ui = mount(A.ScheduleDays, {
    db, showToast() {}, isPremium: true, onUpgrade() {}, block, fresh: true, onBack() {}, update() {},
  });
  try {
    assert.ok(ui.has('When do you train?') || ui.has('Your block is built'),
      'it is framed as the last question of building one: ' + ui.text.slice(0, 200));
    // Confirming the default is a real answer, and the commonest one, so the way out is never dead.
    assert.ok(ui.has('These days are right'), 'and confirming is always pressable: ' + ui.text.slice(-200));
  } finally { ui.unmount(); }
});
