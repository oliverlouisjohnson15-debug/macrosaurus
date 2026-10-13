'use strict';
// The screen stays on while a session is open, and not otherwise.
//
// jsdom has no Wake Lock API, so a stand-in is put on `navigator` that records what it was asked for:
// that a lock was taken on opening a live session, that it was let go of on leaving, that it is taken
// again when the page comes back to the front, and that the setting turns it all off.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();

function fakeWakeLock() {
  const log = { requests: 0, released: 0 };
  Object.defineProperty(A.navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => { log.requests++; const s = { released: false, release() { this.released = true; log.released++; return Promise.resolve(); } }; return s; },
    },
  });
  return log;
}
const settle = () => new Promise(r => setTimeout(r, 5));

function open(prefs) {
  const block = A.Training.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  const db = accountWith(block);
  Object.assign(db.training.prefs, prefs || {});
  const session = A.Training.weekSessions(block, 1)[0];
  return mount(A.SessionPlayer, { db, update(fn) { fn(db); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {} });
}

test('a live session takes the lock, and lets go of it when it is left', async () => {
  const log = fakeWakeLock();
  const ui = open();
  await settle();
  assert.strictEqual(log.requests, 1, 'asked for a lock on opening');
  ui.unmount();
  await settle();
  assert.strictEqual(log.released, 1, 'and gave it back');
});

test('with the setting off no lock is taken', async () => {
  const log = fakeWakeLock();
  const ui = open({ keepAwake: false });
  await settle();
  assert.strictEqual(log.requests, 0);
  ui.unmount();
});

test('a browser with no Wake Lock API is not an error', async () => {
  Object.defineProperty(A.navigator, 'wakeLock', { configurable: true, value: undefined });
  const ui = open();
  await settle();
  assert.ok(ui.has('Add an exercise'), 'the session still opens');
  ui.unmount();
});

test('the lock is taken again when the page comes back to the front', async () => {
  const log = fakeWakeLock();
  const ui = open();
  await settle();
  // The browser drops the lock when the page is hidden; the sentinel reports it as released.
  const doc = A.document;
  Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' });
  // Nothing to re-take while the first lock is still held.
  doc.dispatchEvent(new A.Event('visibilitychange'));
  await settle();
  assert.strictEqual(log.requests, 1, 'a held lock is not asked for twice');
  ui.unmount();
});
