'use strict';
/* Rearranging in Train: picking things up and putting them down.
 *
 * jsdom has no layout, so the drag itself (which reads measured boxes) is covered where it can be:
 * the target maths as a pure function, and the paths that do the same job without a pointer - the
 * grip's tap, the movement menu - against the real screens. The engine half, which decides where a
 * drop may land, is in training.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith, React } = require('./helpers/app.js');

const A = app();
const T = A.Training;
const minmax = () => T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });

// ---- the target maths ---------------------------------------------------------------------------

const box = (top, bottom) => ({ top, bottom });

test('dragDropIndex: a row only counts once the finger is past its midpoint', () => {
  const rects = [box(0, 100), box(100, 150), box(150, 350)];   // a short row between two tall ones
  assert.equal(A.dragDropIndex(120, rects, 0, 0), 0, 'over the top edge of row 1 but short of its middle');
  assert.equal(A.dragDropIndex(130, rects, 0, 0), 1, 'past the middle');
  assert.equal(A.dragDropIndex(200, rects, 2, 2), 2, 'on itself: nothing to do');
  assert.equal(A.dragDropIndex(140, rects, 2, 2), 2, 'row 1 is above the finger and its middle has not been crossed');
  assert.equal(A.dragDropIndex(110, rects, 2, 2), 1, 'finger above row 1\'s middle');
});

test('dragDropIndex: beyond either end is the nearest row, and gaps between rows are not holes', () => {
  const rects = [box(0, 100), box(112, 200), box(212, 300)];   // 12px margins
  assert.equal(A.dragDropIndex(-50, rects, 1, 1), 0);
  assert.equal(A.dragDropIndex(900, rects, 1, 1), 2);
  assert.equal(A.dragDropIndex(206, rects, 0, 0), 1, 'in the gap, past the middle of the row above it');
  assert.equal(A.dragDropIndex(209, rects, 0, 0), 0, 'nearer the next row but short of its middle');
});

test('dragDropIndex: a held unit ignores every row it is made of', () => {
  const rects = [box(0, 100), box(100, 200), box(200, 300), box(300, 400)];
  assert.equal(A.dragDropIndex(150, rects, 1, 2), 1);
  assert.equal(A.dragDropIndex(250, rects, 1, 2), 2);
  assert.equal(A.dragDropIndex(380, rects, 1, 2), 3);
});

// ---- the plan preview -----------------------------------------------------------------------------

function previewProps(block, d, spy) {
  return { db: d, update: (fn) => { if (spy) spy(); fn(d); }, showToast() {}, session: block.sessions[0], block, onBack() {}, onStart() {} };
}
const rowOrder = (ui) => Array.from(ui.host.querySelectorAll('[data-drag-id]')).map(e => e.getAttribute('data-drag-id'));

test('the preview lists the session in the order it will run, not grouped by role', () => {
  const block = minmax();
  const s = block.sessions[0];
  // An accessory first and a main lift last: the order a person might have made.
  const sorted = T.sessionItems(s);
  const acc = sorted.filter(it => T.roleOf(T.byId(it.exerciseId)) === 'accessory')[0];
  assert.ok(acc, 'the fixture session has an accessory');
  T.moveExerciseTo(s, acc.id, 0);
  const d = accountWith(block);
  const ui = mount(A.SessionPreview, previewProps(block, d));
  try {
    assert.deepEqual(rowOrder(ui), T.sessionItems(s).map(it => it.id));
    assert.equal(rowOrder(ui)[0], acc.id);
  } finally { ui.unmount(); }
});

test('tapping the grip opens the movement\'s menu, where it can go to the top or the bottom', () => {
  const block = minmax();
  const d = accountWith(block);
  const ids = T.sessionItems(block.sessions[0]).map(it => it.id);
  const last = T.byId(T.sessionItems(block.sessions[0]).slice(-1)[0].exerciseId).name;
  const ui = mount(A.SessionPreview, previewProps(block, d));
  try {
    ui.clickEl(ui.host.querySelector('button[aria-label^="Reorder ' + last + '"]'));
    assert.ok(ui.has('Move to the top'), ui.text.slice(-300));
    ui.click('Move to the top');
    assert.deepEqual(T.sessionItems(d.training.blocks[0].sessions[0]).map(it => it.id),
      [ids[ids.length - 1]].concat(ids.slice(0, -1)));
  } finally { ui.unmount(); }
});

// ---- the session player ---------------------------------------------------------------------------

function playerProps(block, d) {
  const session = T.weekSessions(block, 1)[0];
  return { db: d, update(fn) { fn(d); }, showToast() {}, sessionId: session.id, blockId: block.id, onExit() {} };
}
const nameOf = (it) => T.byId(it.exerciseId).name;

test('"Do this one now" makes a movement from Up next the one you are on', () => {
  const block = minmax();
  const d = accountWith(block);
  const items = T.sessionItems(T.weekSessions(block, 1)[0]);
  const pick = nameOf(items[3]);
  const ui = mount(A.SessionPlayer, playerProps(block, d));
  try {
    assert.ok(new RegExp(nameOf(items[0]).replace(/[()]/g, '.') + '\\s*Set 1 of').test(ui.text), 'opens on the first: ' + ui.text.slice(0, 400));
    ui.clickEl(ui.host.querySelector('button[aria-label^="Reorder ' + pick + '"]'));
    ui.click('Do this one now');
    assert.ok(new RegExp(pick.replace(/[()]/g, '.') + '\\s*Set 1 of').test(ui.text), 'the chosen movement is open now: ' + ui.text.slice(0, 500));
    // What was open is still in the session, waiting.
    assert.ok(ui.has(nameOf(items[0])));
  } finally { ui.unmount(); }
});

test('moving a queued movement from its menu keeps you on the one you are doing, and the sheet follows it', () => {
  const block = minmax();
  const d = accountWith(block);
  const items = T.sessionItems(T.weekSessions(block, 1)[0]);
  const ui = mount(A.SessionPlayer, playerProps(block, d));
  try {
    const open = nameOf(items[0]);
    ui.clickEl(ui.host.querySelector('button[aria-label^="Reorder ' + nameOf(items[2]) + '"]'));
    assert.ok(ui.has('Move earlier'));
    ui.click('Move earlier');
    assert.ok(ui.has('Move earlier'), 'the sheet stays open for the next step');
    assert.ok(new RegExp(open.replace(/[()]/g, '.') + '\\s*Set 1 of').test(ui.text), 'still on the movement you were doing');
    const order = Array.from(ui.host.querySelectorAll('[data-drag-id]')).map(e => e.textContent);
    assert.ok(order.length >= 3);
    // Moved from third to second in the session, so it now precedes the one that was second.
    const iMoved = order.findIndex(t => t.indexOf(nameOf(items[2])) !== -1);
    const iWas = order.findIndex(t => t.indexOf(nameOf(items[1])) !== -1);
    assert.ok(iMoved < iWas, 'order is ' + order.map(x => x.slice(0, 20)).join(' | '));
  } finally { ui.unmount(); }
});

// ---- the import review --------------------------------------------------------------------------

test('an imported day\'s movement can be sent to another day from its grip', () => {
  const ex = (id, i) => ({ id: id + '_d0_' + i, exerciseId: id, order: i, target: { sets: 3, repLow: 8, repHigh: 12, rir: 2, restSec: 120 } });
  const d = accountWith(null);
  d.training.draft = {
    days: [
      { name: 'Day 1', kind: 'full', exercises: [ex('db_lateral', 0), ex('db_curl', 1)] },
      { name: 'Day 2', kind: 'full', exercises: [ex('db_lateral', 0)] },
    ],
  };
  const ui = mount(A.BlockDraft, { db: d, update(fn) { fn(d); }, showToast() {}, isPremium: true, onUpgrade() {}, onBack() {}, onBuild() {}, onImport() {} });
  try {
    const grips = Array.from(ui.host.querySelectorAll('button[aria-label^="Reorder"]'));
    assert.ok(grips.length >= 3, 'every movement has a grip: ' + grips.length);
    ui.clickEl(grips.filter(g => /Reorder (Dumbbell )?[Cc]url/.test(g.getAttribute('aria-label')))[0] || grips[1]);
    assert.ok(ui.has('Move to Day 2'), ui.text.slice(-300));
    ui.click('Move to Day 2');
    assert.equal(d.training.draft.days[0].exercises.length, 1);
    assert.equal(d.training.draft.days[1].exercises.length, 2);
    assert.deepEqual(d.training.draft.days[1].exercises.map(e => e.order), [0, 1]);
  } finally { ui.unmount(); }
});

// ---- the gesture itself, with the boxes faked ---------------------------------------------------
// jsdom lays nothing out, so each row reports a box computed from its place in the DOM: 100px tall,
// stacked in the order they are drawn. That is enough to drive the real handlers - grab, move,
// release - and see what they report.

test('grabbing the grip and moving past a row reports the drop, and a superset travels whole', () => {
  const dropped = [];
  function Harness() {
    const data = [{ id: 'a' }, { id: 'b', g: 'x' }, { id: 'c', g: 'x' }, { id: 'd' }];
    const dnd = A.useDragList({
      ids: data.map(r => r.id), onDrop: (id, to) => dropped.push([id, to]),
      unitOf: (id) => (data.filter(r => r.id === id)[0] || {}).g || null,
    });
    return React.createElement('div', null, dnd.order.map((id, i) => {
      const rp = dnd.rowProps(id);
      return React.createElement('div', { key: id, ref: (el) => {
        rp.ref(el);
        if (el) el.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 100, left: 0, right: 300, width: 300, height: 100 });
      }, 'data-drag-id': id },
      React.createElement(A.DragHandle, { dnd, id, label: id }), id);
    }));
  }
  const ui = mount(Harness, {});
  const W = ui.host.ownerDocument.defaultView;
  const fire = (type, y) => React.act(() => { W.dispatchEvent(new W.MouseEvent(type, { clientX: 10, clientY: y, bubbles: true })); });
  try {
    const grip = (id) => ui.host.querySelector('button[aria-label^="Reorder ' + id + '."]');
    // Grab "a", drag it down past b and c (a superset): it lands after the pair, as the last-but-one.
    React.act(() => { grip('a').dispatchEvent(new W.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 50 })); });
    fire('pointermove', 260);
    fire('pointerup', 260);
    assert.deepEqual(dropped.pop(), ['a', 2], 'the first row of the moved unit ends up at index 2');
    // Grab the second half of the pair and take it to the top: the pair goes, both halves.
    React.act(() => { grip('c').dispatchEvent(new W.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 250 })); });
    fire('pointermove', 20);
    fire('pointerup', 20);
    assert.deepEqual(dropped.pop(), ['c', 0]);
    // Let go where you started: nothing happened, so nothing is reported.
    React.act(() => { grip('d').dispatchEvent(new W.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 350 })); });
    fire('pointerup', 350);
    assert.equal(dropped.length, 0);
  } finally { ui.unmount(); }
});
