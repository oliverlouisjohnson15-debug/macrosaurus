'use strict';
// Screens, rendered.
//
// Everything else in this suite tests the engine, and the engine has been right about things the
// screens were wrong about: a coverage bar measured against the other style's landmarks, a button
// offering a four-week block that builds six, a stall telling you to change the movement with
// nothing to press. All three were invisible to 1,000 passing tests and obvious within ten seconds
// of opening the app. These render the real components, from the real sources, and assert on what a
// person would actually read.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, render, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;

const minmax = () => T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
const volume = () => T.generateBlock({ daysPerWeek: 4, weeks: 4, shape: 'build4' });
const home = (db, block) => render(A.TrainHome, {
  db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block, onOpen() {}, go() {},
});

// ---- the Train tab -----------------------------------------------------------------------------

test('the tab describes the block it is actually running', () => {
  const db = accountWith(minmax());
  const r = home(db, db.training.blocks[0]);
  assert.ok(r.has('Week 1 of 6'), 'a six-week block should say six: ' + r.text.slice(0, 80));
  assert.ok(r.has('Rest on Wed and Sun'), 'rest days are prescribed and should be named');
  assert.ok(/Intro week/.test(r.text), 'the easy first week should say it is meant to be easy');
  assert.ok(r.has('Opening with'), 'the tab should say what you are about to lift');
  assert.ok(/Chest press machine|Hack squat|Lat pulldown/.test(r.text), 'and name it: ' + r.text.slice(0, 200));
});

test('a volume-model block is described in its own terms', () => {
  const block = volume();
  const db = accountWith(block);
  db.training.prefs.style = 'landmarks';
  const r = home(db, block);
  assert.ok(r.has('Week 1 of 4'));
  assert.ok(!/Intro week/.test(r.text), 'it has no intro week and should not claim one');
  assert.ok(/RIR/.test(r.text), 'its effort is still reps in reserve: ' + r.text.slice(0, 200));
});

test('the build button offers the block it would actually build', () => {
  for (const [style, weeks] of [['minmax', '6-week'], ['landmarks', '4-week']]) {
    const db = accountWith(minmax());
    db.training.blocks = [];
    db.training.prefs = { units: 'kg', style: style };
    const r = home(db, null);
    assert.ok(r.has('Build a ' + weeks + ' block'), style + ' should offer a ' + weeks + ' block: ' + r.text.slice(0, 160));
  }
});

// ---- the session runner ------------------------------------------------------------------------

test('a min-max session asks for failure and stops asking for reps in reserve', () => {
  const block = minmax();
  const db = accountWith(block);
  const session = T.weekSessions(block, 2)[0];
  const r = render(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {}, onFocusMode() {}, gym: null,
  });
  assert.ok(/to failure/.test(r.text), 'the prescription should say so');
  assert.ok(!/\bRIR\b/.test(r.text), 'and nothing should be asking how many reps were left: ' + r.text.slice(0, 300));
  assert.ok(/Stop the first one a rep short|One set here/.test(r.text), 'the set-by-set instruction is the point of the style');
});

test('a volume-model session still logs reps in reserve', () => {
  const block = volume();
  const db = accountWith(block);
  db.training.prefs.style = 'landmarks';
  const session = T.weekSessions(block, 1)[0];
  const r = render(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {}, onFocusMode() {}, gym: null,
  });
  assert.ok(/\bRIR\b/.test(r.text), 'the column and the cue both belong here');
});

// ---- coverage, the bar that was measuring against the wrong table --------------------------------

test('a block is judged against the landmarks of its own style', () => {
  const block = minmax();
  const db = accountWith(block);
  // The wizard left on the OTHER style, which is exactly the case that used to call a complete
  // min-max week short on everything.
  db.training.prefs.style = 'landmarks';
  const r = render(A.CoverageScreen, { db, update() {}, isPremium: true, onUpgrade() {}, blockId: block.id, onBack() {} });
  assert.ok(/Chest \d+(\.\d+)? \/ 4-8/.test(r.text), 'chest should be judged 4-8: ' + (r.text.match(/Chest[^A-Z]*/) || [''])[0]);
  assert.ok(!/\/ 8-22/.test(r.text), 'the volume model\'s ceilings must not appear on a min-max block');
  // And the same block on the other style reads completely differently, which is the whole point of
  // the bug this pins down: one of the two readings is wrong for whoever is looking at it.
  const asVolume = T.coverage(T.blockWeekVolume(block, 2), T.defaultTargets({}));
  assert.ok(asVolume.gaps.length >= 3, 'judged by the volume model a complete min-max week reads as short on '
    + asVolume.gaps.map(g => g.label).join(', ') + ' - which is what this screen used to show somebody');
});

// ---- the block editor ---------------------------------------------------------------------------

test('a slot the plan left open is asked about before the block starts', () => {
  const block = minmax();
  block.sessions.forEach(s => {
    const lead = s.exercises[0];
    lead.choice = { key: 'squat', label: 'Squat - your choice', options: ['back_squat', 'hack_squat', 'pendulum_squat'] };
  });
  const db = accountWith(block);
  const r = render(A.BlockBuilder, { db, update() {}, showToast() {}, isPremium: true, blockId: block.id, onBack() {}, onStart() {} });
  assert.ok(r.has('Your call'), 'the open slot should be asked about: ' + r.text.slice(0, 200));
  assert.ok(/Hack squat/.test(r.text), 'with the options the plan listed');
});

test('a block that runs techniques says what it adds', () => {
  const block = minmax();
  T.applyTechniques(block, {});
  const db = accountWith(block);
  const r = render(A.BlockBuilder, { db, update() {}, showToast() {}, isPremium: true, blockId: block.id, onBack() {}, onStart() {} });
  assert.ok(/intensity technique/.test(r.text), 'the one thing this block adds over the last one');
});

// ---- the wizard ---------------------------------------------------------------------------------

test('the wizard previews the style it is set to', () => {
  const db = accountWith(minmax());
  db.training.blocks = [];
  const r = render(A.BlockWizard, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, onBack() {}, onDraft() {}, onShots() {},
  });
  assert.ok(/How you want to train/.test(r.text), 'the style is the first question');
  assert.ok(/Min-max/.test(r.text));
  assert.ok(/deficit/.test(r.text), 'and a cutting account should be told which one suits it');
});
