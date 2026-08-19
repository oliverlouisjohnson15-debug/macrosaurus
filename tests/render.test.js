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
const { app, render, mount, accountWith } = require('./helpers/app.js');

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
  assert.ok(r.has('Opens with'), 'the tab should say what you are about to lift');
  // The lead exercise is named; what follows it is a count now, not a second and third name (the
  // roll-up above already says which days are done, so listing the next two movements as well was
  // repeating information the continuation line does not need to carry).
  assert.ok(/Machine chest press|Hack squat|Lat pulldown/.test(r.text), 'and name it: ' + r.text.slice(0, 200));
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
  for (const [style, weeks] of [['minmax', '4-week'], ['landmarks', '4-week']]) {
    const db = accountWith(minmax());
    db.training.blocks = [];
    db.training.prefs = { units: 'kg', style: style };
    const r = home(db, null);
    assert.ok(r.has('Build a ' + weeks + ' block'), style + ' should offer a ' + weeks + ' block: ' + r.text.slice(0, 160));
  }
});

test('the tab offers the programmes the app ships with', () => {
  const db = accountWith();
  db.training.blocks = [];
  db.training.prefs = { units: 'kg' };
  const r = render(A.TrainHome, { db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block: null, onOpen() {}, go() {} });
  assert.ok(r.has('Macrosaurus 4 Day'), 'the four-day should be on the tab: ' + r.text.slice(0, 200));
  assert.ok(r.has('Macrosaurus 5 Day'));
  // With their real shape on the card, not a claim that would need checking against the engine.
  assert.ok(/5 days a week/.test(r.text) && /hard sets/.test(r.text));
  // And the split, in the same words the session runner will use.
  assert.ok(r.has('Arms and delts'), 'the day names should be on it: ' + r.text.slice(0, 300));
  // Named the same way as each other. "Default" on one and not the other is two schemes for two
  // things sitting side by side.
  const names = A.Training.PROGRAMMES.map(p => p.name);
  assert.deepEqual(names.map(n => n.replace(/\d/, 'N')), names.map(() => 'Macrosaurus N Day'), names.join(' / '));
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
  // Three days rather than the shared five-day fixture: this needs a block with a real gap, so the
  // screen draws every muscle instead of collapsing to the three nearest a band edge (the fold added
  // once a clean week turned out to be the state a working block is in most weeks).
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 3, sessionMinutes: 45 });
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

// ---- replacing a movement -----------------------------------------------------------------------

const picker = (offer, extra) => render(A.ExercisePicker, Object.assign({
  db: accountWith(minmax()), update() {}, onPick() {}, onClose() {},
  title: 'Replace movement', offer,
}, extra || {}));

test('replacing a movement leads with what the plan itself offers', () => {
  // The whole point of the feature: this screen used to answer "what else could I do here" with a
  // search box over two hundred movements, on a question the programme had already answered.
  const offer = T.replacementsFor({
    exerciseId: 'bb_incline', alts: ['smith_machine_incline_press', 'machine_incline', 'db_incline'],
  }, {});
  // basedOn as the real screens pass it, so the ordering assertions below are about the picker
  // people actually meet rather than a reduced version of it.
  const r = picker(offer, { basedOn: 'bb_incline' });
  assert.ok(r.has('Replace with'), 'the list needs a name: ' + r.text.slice(0, 200));
  assert.ok(/Smith machine incline press/.test(r.text), 'the Smith version');
  assert.ok(/Incline machine press/.test(r.text), 'and the machine version');
  // Above the muscle filters and the library below them, because a list you have to scroll to is a
  // list somebody searches around instead.
  assert.ok(r.text.indexOf('Replace with') < r.text.indexOf('Smith machine incline press'),
    'the heading introduces the list rather than trailing it');
  assert.ok(r.text.indexOf('Smith machine incline press') < r.text.indexOf('Make a variation'),
    'and the plan\'s answer comes before the library\'s');
});

test('the app\'s own suggestions are not passed off as the plan\'s', () => {
  // "Your coach wrote this down" and "this looks similar to us" are different claims. A screen that
  // runs them into one list is quietly lying about which is which.
  const r = picker(T.replacementsFor({ exerciseId: 'bb_incline', alts: ['db_incline'] }, { limit: 4 }));
  assert.ok(r.has('Replace with'), 'the plan\'s one substitution');
  assert.ok(/does the same job/.test(r.text), 'and the worked-out ones, under their own heading');
});

test('a replaced movement offers the way back, marked as the original', () => {
  const row = { exerciseId: 'bb_incline', alts: ['smith_machine_incline_press', 'db_incline'] };
  T.replaceExercise(row, 'smith_machine_incline_press');
  const r = picker(T.replacementsFor(row, {}));
  assert.ok(/Barbell incline press|Incline barbell press/i.test(r.text), 'what the plan asked for is back on the list');
  assert.ok(r.has('As written'), 'and it is labelled as the plan\'s own, not as an alternative');
});

test('nothing is offered before a search when there is nothing written down', () => {
  const r = picker(null);
  assert.ok(!r.has('Replace with'), 'an empty heading over an empty list helps nobody');
});

test('the session screen names the gesture that changes a movement', () => {
  const block = minmax();
  const db = accountWith(block);
  const r = render(A.SessionPreview, {
    db, update() {}, showToast() {}, session: block.sessions[0], block, onBack() {}, onStart() {},
  });
  assert.ok(/Tap a movement to replace it/.test(r.text), 'a chevron never says how: ' + r.text.slice(-260));
});

// ---- tapping a movement and replacing it, end to end ----------------------------------------------
// Everything above renders a screen once. These press the buttons, because the whole feature lives
// behind two taps and passing the picker the wrong list is invisible until you take them.

test('tapping a movement on the session screen offers the plan\'s replacements', () => {
  const block = minmax();
  const first = block.sessions[0].exercises[0];
  first.alts = ['smith_machine_incline_press', 'machine_incline'];
  const name = T.byId(first.exerciseId).name;
  const db = accountWith(block);
  const ui = mount(A.SessionPreview, {
    db, update() {}, showToast() {}, session: block.sessions[0], block, onBack() {}, onStart() {},
  });
  try {
    ui.click(name);
    assert.ok(ui.has('Replace it'), 'the movement\'s options should offer it: ' + ui.text.slice(0, 300));
    ui.click('Replace it');
    assert.ok(ui.has('Replace with'), 'and the picker should open on the plan\'s own answer, not a search box');
    assert.ok(ui.has('Smith machine incline press'), 'listing what the author wrote against this movement');
    assert.ok(ui.has('Incline machine press'), 'all of it');
  } finally { ui.unmount(); }
});

test('a replaced movement says what it is standing in for', () => {
  // Otherwise a block you edited three weeks ago reads exactly like one you did not, and the
  // movement the programme actually asked for is nowhere on the screen.
  const block = minmax();
  const row = block.sessions[0].exercises[0];
  T.replaceExercise(row, 'machine_incline');
  const db = accountWith(block);
  const r = render(A.SessionPreview, {
    db, update() {}, showToast() {}, session: block.sessions[0], block, onBack() {}, onStart() {},
  });
  assert.ok(/instead of Machine chest press/.test(r.text), 'the plan\'s own movement stays visible: ' + r.text.slice(0, 400));
});

test('a movement with nothing written against it still gets somewhere to go', () => {
  // Most movements in a generated block carry no substitutions at all. Opening a bare search box on
  // them would make the feature useless exactly where it is needed most.
  const block = minmax();
  const first = block.sessions[0].exercises[0];
  delete first.alts; delete first.choice;
  const db = accountWith(block);
  const ui = mount(A.SessionPreview, {
    db, update() {}, showToast() {}, session: block.sessions[0], block, onBack() {}, onStart() {},
  });
  try {
    ui.click(T.byId(first.exerciseId).name).click('Replace it');
    assert.ok(/does the same job/i.test(ui.text), 'worked out, and labelled as worked out: ' + ui.text.slice(0, 500));
  } finally { ui.unmount(); }
});

test('a movement can be replaced before the block has started, in every week at once', () => {
  // The screen the whole request was about: deciding what you are actually going to do before any
  // of it has been done. There are no trained weeks to protect here, so it moves the lot.
  const block = minmax();
  block.sessions.forEach(s => { s.exercises[0].exerciseId = 'bb_incline'; s.exercises[0].alts = ['machine_incline']; });
  const db = accountWith(block);
  // accountWith dates the block from today; a block being planned has not started at all, and that
  // is the difference this test is about.
  block.startISO = null;
  db.training.blocks = [block];
  const ui = mount(A.BlockBuilder, {
    db, update() {}, showToast() {}, isPremium: true, blockId: block.id, onBack() {}, onStart() {},
  });
  try {
    ui.click(block.sessions[0].name);
    assert.ok(ui.has('Tap a movement to replace it'), 'the gesture is named: ' + ui.text.slice(0, 300));
    ui.click('Incline barbell press');
    assert.ok(ui.has('Replace with'), 'the picker opens on the plan\'s answer');
    ui.click('Incline machine press');
    // The row in front of you, changed. Not a toast about it.
    assert.ok(ui.has('Incline machine press'), 'the movement on screen is the new one: ' + ui.text.slice(0, 400));
    // The old one survives on screen only in the line saying what this is standing in for, which is
    // the point of that line: the plan's own movement never disappears without trace.
    assert.ok(ui.has('instead of Incline barbell press'), 'with what it replaced still named');
  } finally { ui.unmount(); }
});

test('ticking a set does not take the plan away from the movement', () => {
  // Every row in the player is rebuilt from scratch on each edit, so anything not carried through
  // is lost on the first tap. That quietly took a line's technique, its coaching note and the
  // author's substitutions with it - and, once this feature existed, the way back to what the plan
  // asked for as well.
  const block = minmax();
  const first = block.sessions[0].exercises[0];
  first.alts = ['machine_incline'];
  first.planNote = 'Pause for a second at the bottom.';
  const db = accountWith(block);
  const ui = mount(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: block.sessions[0].id, blockId: block.id, onExit() {},
  });
  try {
    assert.ok(ui.has('Pause for a second at the bottom.'), 'the note is there to begin with: ' + ui.text.slice(0, 300));
    ui.click('Add set');
    assert.ok(ui.has('Pause for a second at the bottom.'), 'and it is still there after an edit');
  } finally { ui.unmount(); }
});

test('replacing a movement in a running block leaves the trained weeks alone', () => {
  // This editor opens on blocks already under way, and its own save button promises that changes
  // apply to the weeks you have not trained yet. Week 1 is history by the time you are in week 3.
  const block = minmax();
  block.sessions.forEach(s => { s.exercises[0].exerciseId = 'bb_incline'; s.exercises[0].alts = ['machine_incline']; });
  const db = accountWith(block);
  // Two weeks in.
  const start = new Date(Date.parse(A.Store.todayISO() + 'T00:00:00Z') - 14 * 86400000);
  block.startISO = start.toISOString().slice(0, 10);
  db.training.blocks = [block];
  let saved = null;
  const ui = mount(A.BlockBuilder, {
    db, update(fn) { saved = fn; }, showToast() {}, isPremium: true, blockId: block.id, onBack() {}, onStart() {},
  });
  try {
    // It opens on the week the block is actually on, so the rows you can still change are the rows
    // in front of you. Opening on week 1 meant tapping a row that the edit could not touch.
    assert.ok(ui.has('Week 3'), 'the screen opens on the week being trained: ' + ui.text.slice(0, 200));
    ui.click(block.sessions.filter(s => s.week === 3)[0].name);
    ui.click('Incline barbell press').click('Incline machine press');
    assert.ok(ui.has('Incline machine press'), 'the week you are on changed: ' + ui.text.slice(0, 400));
    // And the weeks behind it did not. Read off the component's own state by saving.
    ui.click('Save changes');
  } finally { ui.unmount(); }
  assert.ok(saved, 'saving writes the edited block back');
  const d = { training: { blocks: [block] } };
  saved(d);
  const out = d.training.blocks[0];
  const idsIn = w => (out.sessions || []).filter(s => s.week === w)
    .reduce((a, s) => a.concat((s.exercises || []).map(e => e.exerciseId)), []);
  assert.ok(idsIn(1).includes('bb_incline'), 'week 1 was trained and must keep what was lifted');
  assert.ok(idsIn(2).includes('bb_incline'), 'week 2 too');
  assert.ok(!idsIn(3).includes('bb_incline'), 'week 3 is the week being trained and moves');
  assert.ok(idsIn(3).includes('machine_incline'), 'to the movement that was picked');
  assert.ok(idsIn(6).includes('machine_incline'), 'and so does every week after it');
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

// ---- the Game Boy face carries labels, never names -------------------------------------------------
// TRAINING_UI_REVIEW.md §1.2, and its ship record: "Press Start 2P now carries labels and fixed
// strings only", because the face runs about a full em per character and has no narrow forms. Six
// places were converted then; three dialogs were still doing it.

const pfStrings = (html) => [...html.matchAll(/class="[^"]*\bpf\b[^"]*"[^>]*>([^<]+)</g)].map(m => m[1].trim());
const LIBRARY_NAMES = new Set(T.EXERCISES.map(e => e.name));

test('no dialog sets a movement name in the pixel font', () => {
  const db = accountWith();
  const longest = T.EXERCISES.map(e => e.name).sort((a, b) => b.length - a.length).slice(0, 2);
  const sheets = {
    'the swap sheet': render(A.ActionSheet, { kicker: 'Swap', title: longest[0] + ' instead of ' + longest[1], actions: [{ label: 'Just today' }], onClose() {} }),
    'recent sets': render(A.PastSets, { db, exerciseId: 'back_squat', onClose() {} }),
    'why this movement': render(A.TrainHelp, { topic: 'why:hack_squat', db, onClose() {}, onHideForGood() {} }),
  };
  for (const label of Object.keys(sheets)) {
    const inPixelFont = pfStrings(sheets[label].html);
    const names = inPixelFont.filter(x => LIBRARY_NAMES.has(x) || / instead of /.test(x));
    assert.deepEqual(names, [], label + ' sets a movement name in Press Start 2P: ' + JSON.stringify(names));
    assert.ok(inPixelFont.length > 0, label + ' should still have a pixel-font label');
  }
  // And the name is still on screen, in the body face.
  assert.ok(sheets['recent sets'].has('Back squat'));
  assert.ok(sheets['why this movement'].has('Hack squat'));
  assert.ok(sheets['the swap sheet'].has(longest[0] + ' instead of ' + longest[1]));
});

test('a session screen puts no movement name in the pixel font', () => {
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  const session = T.weekSessions(block, 2)[0];
  const r = render(A.SessionPlayer, {
    db, update() {}, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {}, onFocusMode() {}, gym: null,
  });
  const names = pfStrings(r.html).filter(x => LIBRARY_NAMES.has(x));
  assert.deepEqual(names, [], 'movement names in the pixel font: ' + JSON.stringify(names));
});

test('the empty state promises what the STYLE does, not what the length implies', () => {
  // A min-max block set to four weeks was being described as one that "builds on each other and then
  // backs off" - the one thing min-max never does, since it adds no sets and neither shape has a
  // back-off week.
  const cases = [
    ['minmax', 'minmax6', /nothing added week to week/, /build on each other/],
    ['minmax', 'build4', /nothing added week to week/, /build on each other/],
    ['landmarks', 'build4', /build on each other and then back off/, /nothing added week to week/],
    // The two that matter most and that the first version of this test missed: nobody has chosen a
    // style yet. Training.styleOf answers "landmarks" for an absent style, because a block built
    // before styles existed must keep behaving as it did - but the block about to be BUILT is
    // min-max, and reading the promise off styleOf offered a six-week block while describing a
    // four-week one in the same sentence.
    [undefined, undefined, /nothing added week to week/, /build on each other/],
    [undefined, 'build4', /nothing added week to week/, /build on each other/],
  ];
  for (const [style, shape, expected, forbidden] of cases) {
    const db = accountWith();
    db.training.blocks = [];
    db.training.prefs = { units: 'kg', style, shape };
    const r = render(A.TrainHome, { db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block: null, onOpen() {}, go() {} });
    assert.ok(expected.test(r.text), style + '/' + shape + ' should say ' + expected + ': ' + r.text.slice(0, 200));
    assert.ok(!forbidden.test(r.text), style + '/' + shape + ' must not claim ' + forbidden);
    // And the button has to offer the same block the sentence just described.
    const weeks = (r.text.match(/Build a (\d+)-week block/) || [])[1];
    const promised = (r.text.match(/(\d+) weeks/) || [])[1];
    assert.equal(weeks, promised, style + '/' + shape + ': the button offers ' + weeks + ' weeks and the copy promises ' + promised);
  }
});

test('a returning user gets the block the wizard would actually build', () => {
  // Somebody who used this app before styles existed has shape 'build4' saved and no style, and that
  // saved answer carries no opinion about a method that did not exist when they gave it.
  const db = accountWith();
  db.training.blocks = [];
  db.training.prefs = { units: 'kg', shape: 'build4', daysPerWeek: 4, sessionMinutes: 60 };
  const tab = render(A.TrainHome, { db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, block: null, onOpen() {}, go() {} });
  assert.ok(tab.has('Build a 4-week block'), 'the tab should offer the house method: ' + tab.text.slice(0, 120));
  // And the wizard it opens has to agree, or the tab was writing a cheque the next screen bounces.
  const wiz = render(A.BlockWizard, { db, update() {}, showToast() {}, isPremium: true, onUpgrade() {}, onBack() {}, onDraft() {}, onShots() {} });
  assert.ok(/4 weeks/.test(wiz.text), 'the wizard should open on the four-week shape: ' + (wiz.text.match(/[^.]*weeks[^.]*/) || [''])[0]);
});

// ---- run it again, and the rotation wizard inside it ---------------------------------------------
// This screen threw a ReferenceError on every single visit for as long as it existed, because a line
// read the block one line above the const that declares it. Nothing caught it, because nothing
// rendered it. That is the entire reason these exist.

// A block with enough behind it that the rotation engine has something to say: three blocks of
// history and an opening movement whose weight never moved.
function ranAndStalled() {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, shape: 'build4' });
  block.startISO = '2026-07-01';
  const logs = [];
  for (let b = 0; b < 2; b++) {
    (block.sessions || []).slice(0, 8).forEach((s, i) => logs.push({
      id: 'p' + b + i, blockId: 'prior' + b, sessionId: 'p' + b + 's' + i,
      dateISO: '2026-0' + (3 + b) + '-' + String(1 + i).padStart(2, '0'),
      sets: (s.exercises || []).map(e => ({ exerciseId: e.exerciseId, done: true, reps: 8, rir: 2, weightKg: 50 })),
    }));
  }
  (block.sessions || []).forEach((s, i) => {
    const sets = [];
    (s.exercises || []).forEach((e, j) => {
      for (let k = 0; k < (e.target.sets || 3); k++) {
        sets.push({ exerciseId: e.exerciseId, done: true, reps: 8, rir: 2, weightKg: j === 0 ? 60 : 40 + s.week * 5 });
      }
    });
    logs.push({ id: 'l' + i, blockId: block.id, sessionId: s.id, dateISO: '2026-07-' + String(1 + i).padStart(2, '0'), sets });
  });
  const db = accountWith(block);
  db.training.logs = logs;
  db.training.prefs.style = block.style;
  return { db, block };
}
const rerun = (db, block) => render(A.RerunScreen, {
  db, update() {}, showToast() {}, blockId: block.id, onBack() {}, onDraft() {},
});

test('run it again renders at all', () => {
  const { db, block } = ranAndStalled();
  const r = rerun(db, block);
  assert.ok(r.has('Run it again'), 'the screen did not render: ' + r.text.slice(0, 120));
  assert.ok(/Worth a change|Keep as-is/.test(r.text), 'the movement list is the point of the screen');
  assert.ok(/Build it/.test(r.text), 'and there has to be a way out of it');
});

test('it names the movements and what they would become', () => {
  const { db, block } = ranAndStalled();
  const r = rerun(db, block);
  assert.ok(/Worth changing|Your call/.test(r.text), 'no verdict was shown: ' + r.text.slice(0, 200));
  // A rotation that is switched on has to say what it turns into, or the switch means nothing.
  assert.ok(/&rarr;|→/.test(r.html), 'a switched-on rotation did not name its replacement');
});

test('a rotation says what it costs, where the cost is real', () => {
  const { db, block } = ranAndStalled();
  const r = rerun(db, block);
  assert.ok(/numbers start again/.test(r.text),
    'a main lift was offered for rotation without saying the run on it restarts: ' + r.text.slice(0, 300));
});

test('every other movement is one tap away, not gone', () => {
  const { db, block } = ranAndStalled();
  const r = rerun(db, block);
  assert.ok(/Keep as-is|more, all readable/.test(r.text),
    'the rest of the block was hidden with no way back to it: ' + r.text.slice(0, 200));
});

test('a block with no history still gives a screen rather than an error', () => {
  const db = accountWith();
  const block = db.training.blocks[0];
  const r = rerun(db, block);
  assert.ok(r.has('Run it again'));
  assert.ok(/Nothing here needs changing|Nothing here has to change/.test(r.text),
    'an unrun block should say there is nothing to go on: ' + r.text.slice(0, 200));
});

test('a block that has been deleted underneath you says so', () => {
  const db = accountWith();
  const r = render(A.RerunScreen, { db, update() {}, showToast() {}, blockId: 'gone', onBack() {}, onDraft() {} });
  assert.ok(r.has('not here any more'), r.text.slice(0, 120));
});

test('a clean coverage week collapses to the three closest to a band edge', () => {
  // Nothing short, nothing over: the state a working block is in most weeks. Seventeen identical
  // green bars answered a question nobody asked, so it collapses to a verdict and the three worth a
  // glance, with a way to open the rest.
  const block = minmax();
  const db = accountWith(block);
  const r = render(A.CoverageScreen, { db, update() {}, isPremium: true, onUpgrade() {}, blockId: block.id, onBack() {} });
  assert.ok(r.has('Nothing to fix'), 'a clean week should say so: ' + r.text.slice(0, 200));
  assert.ok(/All \d+ muscles/.test(r.text), 'and still offer the way to see everything');
});
