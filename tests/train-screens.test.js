'use strict';
/* Every screen in the Train module, drawn against the accounts people actually have.
 *
 * The module is fifteen screens and about seven thousand lines, and most of them are reachable only
 * behind a block, a log, a draft or a subscription - so a screen that throws on an empty account, or
 * on a block that has finished, or on a movement with one session against it, can sit there for
 * months without anybody meeting it. This is the net under all of them: draw each one against every
 * shape of account, and assert only that it draws. Anything asserting what a screen SAYS belongs in
 * render.test.js next to the rest.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, render, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;
const today = () => A.Store.todayISO();
const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const noop = () => {};

const minmax = () => T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
const volume = () => T.generateBlock({ daysPerWeek: 4, weeks: 4, shape: 'build4' });

// A log for a session, of the shape the runner writes.
function logFor(session, block, opts) {
  const o = opts || {};
  const dateISO = o.dateISO || today();
  return {
    id: o.id || 'log_' + session.id, dateISO: dateISO, blockId: block ? block.id : null,
    sessionId: session.id, name: session.name,
    startedAt: new Date(Date.parse(dateISO + 'T00:30:00Z')).toISOString(),
    endedAt: o.open ? null : new Date(Date.parse(dateISO + 'T01:30:00Z')).toISOString(),
    sets: (session.exercises || []).slice(0, 3).reduce((a, e, i) => a.concat([0, 1, 2].map(si => ({
      exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work',
      weightKg: 50 + i * 5 + si, reps: 8, rir: 1, done: true,
    }))), []),
  };
}

/* The accounts. Each is a shape somebody is actually in, and each has broken something in this
   module before: an empty one (nothing to read off), a block mid-run, a block that has finished
   (blockProgress goes past the last week), and one carrying a draft basket and two gyms. */
function accounts() {
  const running = minmax();
  const withRunning = accountWith(running);
  withRunning.training.logs = T.weekSessions(running, 1).slice(0, 2)
    .map((s, i) => logFor(s, running, { id: 'l' + i, dateISO: shift(today(), -i) }));

  const finished = volume();
  const withFinished = accountWith(finished);
  finished.startISO = shift(today(), -70);
  withFinished.training.blocks = [finished];
  withFinished.training.logs = (finished.sessions || []).slice(0, 6)
    .map((s, i) => logFor(s, finished, { id: 'f' + i, dateISO: shift(today(), -60 + i * 2) }));

  const empty = accountWith(minmax());
  empty.training.blocks = [];
  empty.training.logs = [];

  const midSession = minmax();
  const withOpen = accountWith(midSession);
  withOpen.training.logs = [logFor(T.weekSessions(midSession, 1)[0], midSession, { open: true })];

  const messy = accountWith(minmax());
  messy.training.gyms = [
    { id: 'g1', name: 'Home', equipment: ['db', 'bench'] },
    { id: 'g2', name: 'The gym', equipment: ['bb', 'db', 'machine', 'cable'] },
  ];
  messy.training.prefs.currentGymId = 'g2';
  messy.training.draft = {
    name: 'Some plan',
    days: [
      { name: 'Upper', dayOfWeek: 0, exercises: [{ id: 'i1', exerciseId: 'bb_bench', order: 0, target: { sets: 3, repLow: 6, repHigh: 8, rir: 1 } }] },
      // A day the parse could make nothing of. The importer writes an empty list here, but a draft
      // saved by an older build - or a hand-edited one - can arrive with no list at all, and this
      // screen is the one thing standing between an AI read and the person looking at it.
      { name: 'Rest of it' },
    ],
  };
  messy.training.custom = [{ id: 'cus_1', name: 'Coach press', pattern: 'push', primary: ['chest'], secondary: [], equipment: 'machine' }];

  return {
    empty: empty,
    running: withRunning,
    finished: withFinished,
    midSession: withOpen,
    messy: messy,
  };
}

const ACCOUNTS = accounts();
const blockOf = (db) => (db.training.blocks || [])[0] || null;

// Every screen, with the props its own router hands it.
const SCREENS = [
  ['TrainHome', (db) => ({ db, update: noop, showToast: noop, isPremium: true, onUpgrade: noop, block: blockOf(db), onOpen: noop, onFreeform: noop, go: noop })],
  ['BlockList', (db) => ({ db, update: noop, showToast: noop, onBack: noop, onOpen: noop, onNew: noop, onCoverage: noop, onReview: noop, onStart: noop, onProgramme: noop })],
  ['BlockLibrary', (db) => ({ db, update: noop, showToast: noop, isPremium: true, onUpgrade: noop, onBack: noop, onAdopt: noop })],
  ['BlockDraft', (db) => ({ db, update: noop, showToast: noop, isPremium: true, onUpgrade: noop, onBack: noop, onBuild: noop, onImport: noop })],
  ['BlockWizard', (db) => ({ db, update: noop, showToast: noop, isPremium: true, onUpgrade: noop, onBack: noop, onDraft: noop, onShots: noop })],
  ['TrainHistory', (db) => ({ db, update: noop, onBack: noop, onOpenExercise: noop, onOpenSession: noop })],
  ['TrainSettings', (db) => ({ db, update: noop, showToast: noop, onBack: noop, onHowItWorks: noop })],
  ['HowItWorks', () => ({ onBack: noop })],
  ['StatSheet', (db) => ({ db, onBack: noop })],
  ['GymPicker', (db) => ({ db, update: noop, onClose: noop, onPicked: noop })],
];

// The screens that need a block to point at. Skipped where an account has none, because their own
// router does not offer them there either.
const BLOCK_SCREENS = [
  ['CoverageScreen', (db, b) => ({ db, update: noop, isPremium: true, onUpgrade: noop, blockId: b.id, onBack: noop })],
  ['BlockReviewScreen', (db, b) => ({ db, update: noop, showToast: noop, isPremium: true, onUpgrade: noop, blockId: b.id, onBack: noop, onNext: noop, onRerun: noop })],
  ['RerunScreen', (db, b) => ({ db, update: noop, showToast: noop, blockId: b.id, onBack: noop, onDraft: noop })],
  ['BlockBuilder', (db, b) => ({ db, update: noop, showToast: noop, isPremium: true, blockId: b.id, onBack: noop, onStart: noop })],
  ['SessionPreview', (db, b) => ({ db, update: noop, showToast: noop, session: T.weekSessions(b, 1)[0] || (b.sessions || [])[0], block: b, onBack: noop, onStart: noop })],
  ['SessionPlayer', (db, b) => {
    const s = T.weekSessions(b, 1)[0] || (b.sessions || [])[0];
    return { db, update: noop, showToast: noop, sessionId: s.id, blockId: b.id, onExit: noop, onFocusMode: noop, gym: null };
  }],
];

Object.keys(ACCOUNTS).forEach(shape => {
  const db = ACCOUNTS[shape];
  SCREENS.forEach(([name, props]) => {
    test(name + ' draws on a ' + shape + ' account', () => {
      const r = render(A[name], props(db));
      assert.ok(r.html.length > 0, 'it rendered something');
    });
  });
  const b = blockOf(db);
  if (!b) return;
  BLOCK_SCREENS.forEach(([name, props]) => {
    test(name + ' draws on a ' + shape + ' account', () => {
      const r = render(A[name], props(db, b));
      assert.ok(r.html.length > 0, 'it rendered something');
    });
  });
});

// Free accounts see different screens - a paywall rather than the thing - and the paywalled halves
// have their own render paths.
test('the premium screens draw for somebody who has not paid', () => {
  const db = ACCOUNTS.running;
  const b = blockOf(db);
  [
    [A.CoverageScreen, { db, update: noop, isPremium: false, onUpgrade: noop, blockId: b.id, onBack: noop }],
    [A.BlockReviewScreen, { db, update: noop, showToast: noop, isPremium: false, onUpgrade: noop, blockId: b.id, onBack: noop, onNext: noop, onRerun: noop }],
    [A.BlockLibrary, { db, update: noop, showToast: noop, isPremium: false, onUpgrade: noop, onBack: noop, onAdopt: noop }],
    [A.BlockDraft, { db, update: noop, showToast: noop, isPremium: false, onUpgrade: noop, onBack: noop, onBuild: noop, onImport: noop }],
    [A.BlockWizard, { db, update: noop, showToast: noop, isPremium: false, onUpgrade: noop, onBack: noop, onDraft: noop, onShots: noop }],
    [A.TrainHome, { db, update: noop, showToast: noop, isPremium: false, onUpgrade: noop, block: b, onOpen: noop, onFreeform: noop, go: noop }],
  ].forEach(([C, props]) => { assert.ok(render(C, props).html.length > 0); });
});

// A movement with exactly one session against it has no chart to draw, no delta to compute and no
// stall to detect: every one of those is a division or a slice on a list of one.
test('a movement detail draws on one session, on none, and on a rotation', () => {
  const db = ACCOUNTS.running;
  const anyId = (db.training.logs[0].sets || [])[0].exerciseId;
  assert.ok(render(A.ExerciseDetail, { db, exerciseId: anyId, onBack: noop }).html.length > 0);
  assert.ok(render(A.ExerciseDetail, { db, exerciseId: 'never_logged_movement', onBack: noop }).html.length > 0);
  const rotated = JSON.parse(JSON.stringify(db));
  rotated.training.rotations = [{ fromId: anyId, toId: 'db_bench', dateISO: today() }];
  assert.ok(render(A.ExerciseDetail, { db: rotated, exerciseId: 'db_bench', onBack: noop }).html.length > 0);
});

// A block whose start date is in the future, which is what "save for later, start Monday" produces.
test('the tab draws on a block that has not started yet', () => {
  const block = minmax();
  const db = accountWith(block);
  block.startISO = shift(today(), 3);
  db.training.blocks = [block];
  assert.ok(render(A.TrainHome, {
    db, update: noop, showToast: noop, isPremium: true, onUpgrade: noop, block, onOpen: noop, onFreeform: noop, go: noop,
  }).html.length > 0);
});

// The Training settings' one-line summary of the volume bands: it exists to say, in most visits,
// that you have not moved anything.
test('an untouched account is not told it has changed all seventeen bands', () => {
  const noop2 = () => {};
  ['minmax', 'landmarks'].forEach(style => {
    const block = style === 'minmax' ? minmax() : volume();
    const db = accountWith(block);
    db.training.prefs.style = style;
    db.training.volumeTargets = {};
    db.training.volumeTargetsMinmax = {};
    const r = render(A.TrainSettings, { db, update: noop2, showToast: noop2, onBack: noop2, onHowItWorks: noop2 });
    assert.ok(!/changed from default/.test(r.text),
      style + ': nothing has been changed, so nothing should say it has: ' + r.text.slice(0, 200));
  });
});

test('a band somebody actually moved is still counted', () => {
  const noop2 = () => {};
  const db = accountWith(minmax());
  db.training.prefs.style = 'minmax';
  const bands = T.defaultTargets({ experience: db.training.prefs.experience, style: 'minmax' });
  const m = T.MUSCLES[0];
  db.training.volumeTargetsMinmax = { [m]: { mev: bands[m].mev, mav: bands[m].mav + 3, mrv: bands[m].mrv + 3 } };
  const r = render(A.TrainSettings, { db, update: noop2, showToast: noop2, onBack: noop2, onHowItWorks: noop2 });
  assert.ok(/1 changed from default/.test(r.text), 'one, and only one: ' + r.text.slice(0, 200));
});

/* ---- a saved gym must not read as its own subtitle -----------------------------------------------
   Reported from a real account: "Where you train" listing seven gyms, six of them called
   "Bodybuilding gym" over a second line also reading "Bodybuilding gym". The name falls back to the
   gym's KIND when you save without typing one, and the summary line opened with that same kind. */

test('an unnamed gym does not print its own name twice', () => {
  const noop2 = () => {};
  const db = accountWith(minmax());
  // Exactly what saving with the name field blank produces: named after its kind.
  const label = A.Training.GYMS.commercial.label;
  db.training.gyms = [{ id: 'g1', name: label, type: 'commercial' }];
  db.training.prefs.currentGymId = 'g1';
  const r = render(A.TrainSettings, { db, update: noop2, showToast: noop2, onBack: noop2, onHowItWorks: noop2 });
  const i = r.text.indexOf('Where you train');
  const row = r.text.slice(i, i + 120);
  const hits = row.split(label).length - 1;
  assert.equal(hits, 1, 'the kind is said once, not once as the name and again under it: ' + row);
});

test('a named gym still says what kind of place it is', () => {
  const noop2 = () => {};
  const db = accountWith(minmax());
  db.training.gyms = [{ id: 'g1', name: 'Ultra flex West', type: 'commercial' }];
  const r = render(A.TrainSettings, { db, update: noop2, showToast: noop2, onBack: noop2, onHowItWorks: noop2 });
  assert.ok(r.text.indexOf('Ultra flex West') !== -1, 'the name');
  assert.ok(r.text.indexOf(A.Training.GYMS.commercial.label) !== -1, 'and the kind, which is not the name here');
});

test('the gym you are set to is marked, because same-kind gyms have nothing else to tell them apart', () => {
  const noop2 = () => {};
  const db = accountWith(minmax());
  db.training.gyms = [
    { id: 'g1', name: 'Bodybuilding gym', type: 'commercial' },
    { id: 'g2', name: 'Bodybuilding gym 2', type: 'commercial' },
  ];
  db.training.prefs.currentGymId = 'g2';
  const r = render(A.TrainSettings, { db, update: noop2, showToast: noop2, onBack: noop2, onHowItWorks: noop2 });
  assert.ok(/Where you are now/.test(r.text), 'one of them says which: ' + r.text.slice(r.text.indexOf('Where you train'), r.text.indexOf('Where you train') + 160));
});
