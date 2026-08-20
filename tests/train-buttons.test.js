'use strict';
/* Every button on every Train screen, pressed.
 *
 * This suite exists because of two faults that shipped together and looked identical from the
 * outside: "Start" on the session preview, which set a piece of state that only the home screen
 * drew, and "Empty session", which set a piece of state that nothing drew at all. Both were a real
 * control, in the right place, with the right words on it, that did nothing whatsoever when tapped.
 * No render test can see that - the screen looks perfect - and no engine test goes near it.
 *
 * So: mount a screen, find every control on it, and press each one on its own fresh copy. A press
 * has to DO something - change what is on screen, call one of the screen's own callbacks, or write
 * to the store. A control that does none of the three is either dead or the thing under it is.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;
const today = () => A.Store.todayISO();
const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const minmax = () => T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });

/* Controls that are allowed to look like they did nothing.
 *
 * Each is a button whose whole effect is outside the app - the clipboard, the share sheet, a file
 * picker, a link out - or one whose effect is a store write this harness deliberately does not feed
 * back into the screen. Kept short and named one by one: the moment this list is a way of getting a
 * screen to pass, it stops being worth having. */
const OUTSIDE_THE_APP = [
  'Copy link', 'Share', 'Copy', 'Choose files', 'Add photos', 'Paste',
];

function labelOf(el) {
  return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/* Press every control on a screen, each on its own freshly mounted copy, and return the ones that
   did nothing at all. `make` builds { Component, props } and is called again for every press, so no
   two presses can interfere with each other. */
function deadControls(make) {
  const probe = make(() => {});
  const first = mount(probe.Component, probe.props);
  let labels;
  try {
    labels = Array.from(first.host.querySelectorAll('button, [role="button"]')).map(labelOf);
  } finally { first.unmount(); }

  const dead = [];
  labels.forEach((label, i) => {
    let fired = false;
    const fresh = make(() => { fired = true; });
    const ui = mount(fresh.Component, fresh.props);
    try {
      const buttons = Array.from(ui.host.querySelectorAll('button, [role="button"]'));
      const el = buttons[i];
      if (!el) return;                       // the screen drew differently this time; not a finding
      // The whole markup, not just the words: a control whose job is to select the thing it belongs
      // to - a week, a tab, a lens - changes a highlight rather than a sentence, and that is a real
      // effect. What this is looking for is a press that changes nothing at all.
      const before = ui.host.innerHTML;
      ui.clickEl(el);
      const after = ui.host.innerHTML;
      if (!fired && before === after && !OUTSIDE_THE_APP.some(x => label.indexOf(x) !== -1)) {
        dead.push(label || '(unlabelled button ' + i + ')');
      }
    } finally { ui.unmount(); }
  });
  return dead;
}

// The account every screen below is drawn against: a block running, two gyms saved (which is what
// puts the gym question in the way of starting a session), and one session already in the bag.
function db() {
  const block = minmax();
  const d = accountWith(block);
  d.training.gyms = [
    { id: 'g1', name: 'Home', equipment: ['db', 'bench'] },
    { id: 'g2', name: 'The gym', equipment: ['bb', 'db', 'machine', 'cable'] },
  ];
  d.training.prefs.currentGymId = 'g2';
  const done = T.weekSessions(block, 1)[0];
  d.training.logs = [{
    id: 'l0', dateISO: shift(today(), -1), blockId: block.id, sessionId: done.id, name: done.name,
    startedAt: new Date(Date.parse(shift(today(), -1) + 'T00:30:00Z')).toISOString(),
    endedAt: new Date(Date.parse(shift(today(), -1) + 'T01:30:00Z')).toISOString(),
    sets: (done.exercises || []).slice(0, 2).reduce((a, e) => a.concat([0, 1].map(si => ({
      exerciseId: e.exerciseId, itemId: e.id, setIndex: si, type: 'work', weightKg: 60, reps: 8, done: true,
    }))), []),
  }];
  return d;
}

/* `selected` names the controls that are the current choice in their own group when the screen
   opens - the tab you are on, the lens you are looking through, the week you are in. Pressing the
   thing you have already got changes nothing, correctly, and that is the only reason a control is
   ever allowed on this list. Named one by one and per screen, so a control that goes dead cannot
   hide behind a general exception. */
function check(name, make, selected) {
  test('every control on ' + name + ' does something', () => {
    const dead = deadControls(make).filter(l => (selected || []).indexOf(l) === -1);
    assert.deepEqual(dead, [], 'these did nothing when pressed: ' + dead.join(' | '));
  });
}

check('the Train tab', (spy) => ({
  Component: A.TrainTab,
  props: {
    db: db(), update: (fn) => { spy(); fn({ training: { blocks: [], logs: [], custom: [] } }); },
    showToast: spy, isPremium: true, onUpgrade: spy, onFocusMode: spy,
  },
}));

check('the session preview', (spy) => {
  const d = db();
  const block = d.training.blocks[0];
  return {
    Component: A.SessionPreview,
    props: {
      db: d, update: (fn) => { spy(); fn(d); }, showToast: spy,
      session: T.weekSessions(block, 1)[0], block: block, onBack: spy, onStart: spy,
    },
  };
});

check('the session runner', (spy) => {
  const d = db();
  const block = d.training.blocks[0];
  return {
    Component: A.SessionPlayer,
    props: {
      db: d, update: (fn) => { spy(); fn(d); }, showToast: spy,
      sessionId: T.weekSessions(block, 1)[0].id, blockId: block.id,
      onExit: spy, onFocusMode: spy, gym: d.training.gyms[1],
    },
  };
});

check('the history screen', (spy) => {
  const d = db();
  return {
    Component: A.TrainHistory,
    props: { db: d, update: (fn) => { spy(); fn(d); }, onBack: spy, onOpenExercise: spy, onOpenSession: spy },
  };
}, ['Your lifts']);

check('the blocks list', (spy) => {
  const d = db();
  return {
    Component: A.BlockList,
    props: {
      db: d, update: (fn) => { spy(); fn(d); }, showToast: spy,
      onBack: spy, onOpen: spy, onNew: spy, onCoverage: spy, onReview: spy, onStart: spy, onProgramme: spy,
    },
  };
});

check('the block builder', (spy) => {
  const d = db();
  return {
    Component: A.BlockBuilder,
    props: {
      db: d, update: (fn) => { spy(); fn(d); }, showToast: spy, isPremium: true,
      blockId: d.training.blocks[0].id, onBack: spy, onStart: spy,
    },
  };
});

check('the training settings', (spy) => {
  const d = db();
  return {
    Component: A.TrainSettings,
    props: { db: d, update: (fn) => { spy(); fn(d); }, showToast: spy, onBack: spy, onHowItWorks: spy },
  };
});

check('the stat sheet', (spy) => {
  const d = db();
  return { Component: A.StatSheet, props: { db: d, onBack: spy } };
});

check('the coverage screen', (spy) => {
  const d = db();
  return {
    Component: A.CoverageScreen,
    props: { db: d, update: (fn) => { spy(); fn(d); }, isPremium: true, onUpgrade: spy, blockId: d.training.blocks[0].id, onBack: spy },
  };
}, ['Planned', 'W1']);
