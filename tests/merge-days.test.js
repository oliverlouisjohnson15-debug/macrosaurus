'use strict';
/* Merging days: a four-day week out of a five-day block, for one week only.
 *
 * The case it was built for: PPL Hybrid, week two, Upper and Lower 1 done, Push, Pull and Legs 2
 * left and time for two of them. Push + Pull become one session at the Upper day's volume, made of
 * the Push and Pull days' own movements, and next week is the plan again.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

const START = '2026-11-16';                 // a Monday
const WED = '2026-11-25';                   // week two
const clone = (x) => JSON.parse(JSON.stringify(x));

function ppl() {
  const b = T.programmeBlock('pplh5', {});
  b.startISO = START;
  return b;
}
const wk = (b, w) => T.weekSessions(b, w);
const byName = (b, w, n) => wk(b, w).filter(s => s.name === n)[0];
const doneLog = (b, s, dateISO) => ({ id: 'l_' + s.id, blockId: b.id, sessionId: s.id, dateISO, endedAt: dateISO + 'T10:00:00Z', sets: [] });
function weekTwoSoFar(b) {
  return [doneLog(b, byName(b, 2, 'Upper'), '2026-11-23'), doneLog(b, byName(b, 2, 'Lower 1'), '2026-11-24')];
}
const sets = (s) => s.exercises.reduce((n, e) => n + e.target.sets, 0);

test('Push + Pull mirror the Upper day: its volume, their movements', () => {
  const b = ppl();
  const logs = weekTwoSoFar(b);
  const push = byName(b, 2, 'Push'), pull = byName(b, 2, 'Pull'), upper = byName(b, 2, 'Upper');
  const r = T.mergeSessions(b, [push.id, pull.id], { logs, todayISO: WED });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.mode, 'mirror');
  assert.equal(r.ref.name, 'Upper');
  assert.equal(r.session.name, 'Push + Pull');
  assert.equal(r.session.kind, 'upper');
  // The Upper day's set count, line for line.
  assert.equal(sets(r.session), sets(upper));
  assert.deepEqual(r.session.exercises.map(e => e.target.sets), upper.exercises.map(e => e.target.sets));
  // Every movement is one the Push or Pull day had.
  const theirs = new Set(push.exercises.concat(pull.exercises).map(e => e.exerciseId));
  r.session.exercises.forEach(e => assert.ok(theirs.has(e.exerciseId), e.exerciseId + ' is not from Push or Pull'));
  // Pull's T-bar row takes Upper's row slot, rather than Upper's own row being kept.
  assert.ok(r.session.exercises.some(e => e.exerciseId === 'tbar_row'));
  assert.ok(!r.session.exercises.some(e => e.exerciseId === 'prime_row'));
  // Nothing the two days trained loses its weekly touch.
  assert.ok(r.left.length > 0, 'something had to give');
});

test('the week now has four sessions and four done is the whole week', () => {
  const b = ppl();
  const logs = weekTwoSoFar(b);
  const r = T.mergeSessions(b, [byName(b, 2, 'Push').id, byName(b, 2, 'Pull').id], { logs, todayISO: WED });
  assert.equal(wk(b, 2).length, 4);
  const after = logs.concat([doneLog(b, r.session, '2026-11-26'), doneLog(b, byName(b, 2, 'Legs 2'), '2026-11-28')]);
  const row = T.blockWeeks(b, after, '2026-11-29')[1];
  assert.equal(row.total, 4);
  assert.equal(row.full, true);
});

test('next week is the plan again, untouched', () => {
  const b = ppl();
  const before = clone(wk(b, 3).concat(wk(b, 1), wk(b, 4)));
  T.mergeSessions(b, [byName(b, 2, 'Push').id, byName(b, 2, 'Pull').id], { logs: weekTwoSoFar(b), todayISO: WED });
  assert.deepEqual(clone(wk(b, 3).concat(wk(b, 1), wk(b, 4))), before);
});

test('splitting puts the original days back exactly', () => {
  const b = ppl();
  const was = clone(b);
  const r = T.mergeSessions(b, [byName(b, 2, 'Push').id, byName(b, 2, 'Pull').id], { logs: weekTwoSoFar(b), todayISO: WED });
  const s = T.splitSession(b, r.session.id, { logs: weekTwoSoFar(b) });
  assert.equal(s.ok, true);
  assert.deepEqual(clone(b), was);
});

test('repeatable: a merge merged again starts from the original days, and splits back to all of them', () => {
  const b = ppl();
  const was = clone(b);
  const logs = weekTwoSoFar(b);
  const one = T.mergeSessions(b, [byName(b, 2, 'Push').id, byName(b, 2, 'Pull').id], { logs, todayISO: WED });
  const two = T.mergeSessions(b, [one.session.id, byName(b, 2, 'Legs 2').id], { logs, todayISO: WED });
  assert.equal(two.ok, true, two.reason);
  assert.equal(two.session.name, 'Push + Pull + Legs 2');
  assert.equal(two.session.merged.from.length, 3);
  assert.ok(!two.session.merged.from.some(s => s.merged), 'no merge nested inside a merge');
  assert.equal(wk(b, 2).length, 3);
  T.splitSession(b, two.session.id, { logs });
  assert.deepEqual(clone(b), was);
});

test('refuses anything with a log against it, and weeks behind you', () => {
  const b = ppl();
  const logs = weekTwoSoFar(b);
  const r = T.mergePlan(b, [byName(b, 2, 'Upper').id, byName(b, 2, 'Push').id], { logs, todayISO: WED });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Upper/);
  const past = T.mergePlan(b, [byName(b, 1, 'Push').id, byName(b, 1, 'Pull').id], { logs, todayISO: WED });
  assert.equal(past.ok, false);
  const mixed = T.mergePlan(b, [byName(b, 2, 'Push').id, byName(b, 3, 'Pull').id], { logs, todayISO: WED });
  assert.equal(mixed.ok, false);
  // A merged session that has been started cannot be split.
  const m = T.mergeSessions(b, [byName(b, 2, 'Push').id, byName(b, 2, 'Pull').id], { logs, todayISO: WED });
  assert.equal(T.splitSession(b, m.session.id, { logs: logs.concat([doneLog(b, m.session, WED)]) }).ok, false);
});

test('planning a later week ahead is allowed', () => {
  const b = ppl();
  const r = T.mergeSessions(b, [byName(b, 3, 'Push').id, byName(b, 3, 'Pull').id], { logs: [], todayISO: WED });
  assert.equal(r.ok, true, r.reason);
  assert.equal(wk(b, 3).length, 4);
  assert.equal(wk(b, 2).length, 5);
});

test('no day fits: budgeted to one session, never a one-set line', () => {
  const b = ppl();
  const pull = byName(b, 2, 'Pull'), legs = byName(b, 2, 'Legs 2');
  const r = T.mergePlan(b, [pull.id, legs.id], { logs: weekTwoSoFar(b), todayISO: WED });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'budget');
  assert.equal(r.ref, null);
  r.rows.forEach(row => assert.ok(row.line.target.sets >= 2 || row.line.target.sets === 1 && pull.exercises.concat(legs.exercises).some(e => e.exerciseId === row.line.exerciseId && e.target.sets === 1),
    row.line.exerciseId + ' was cut to one set'));
  assert.ok(r.sets <= Math.max(sets(pull), sets(legs)) + 2, 'about one session long: ' + r.sets);
  assert.ok(r.sets < sets(pull) + sets(legs));
});

test('frequency guard: a muscle the week would otherwise lose keeps a line', () => {
  // Upper trains chest and back. Push also has the week's only calf work: mirroring Upper alone
  // would drop calves to zero for the week, so the calf raise comes back.
  const tpl = [
    { name: 'Upper', kind: 'upper', dayOfWeek: 0, exercises: [
      { exerciseId: 'machine_press', target: { sets: 3, repLow: 8, repHigh: 10 } },
      { exerciseId: 'lat_pulldown', target: { sets: 3, repLow: 8, repHigh: 10 } }] },
    { name: 'Push', kind: 'push', dayOfWeek: 2, exercises: [
      { exerciseId: 'pec_deck', target: { sets: 3, repLow: 8, repHigh: 10 } },
      { exerciseId: 'standing_calf', target: { sets: 2, repLow: 8, repHigh: 10 } }] },
    { name: 'Pull', kind: 'pull', dayOfWeek: 3, exercises: [
      { exerciseId: 'machine_pullover', target: { sets: 3, repLow: 8, repHigh: 10 } }] },
  ];
  const b = T.blockFromTemplate(tpl, { weeks: 2, asWritten: true });
  const push = T.weekSessions(b, 1).filter(s => s.name === 'Push')[0];
  const pull = T.weekSessions(b, 1).filter(s => s.name === 'Pull')[0];
  const r = T.mergePlan(b, [push.id, pull.id], {});
  assert.equal(r.mode, 'mirror');
  const calf = r.rows.filter(x => x.line.exerciseId === 'standing_calf')[0];
  assert.ok(calf, 'calves kept');
  assert.equal(calf.guard, 'ca');
});

test('suggestions: Push + Pull first, and an overbooked week is noticed', () => {
  const b = ppl();
  const logs = weekTwoSoFar(b);
  const s = T.mergeSuggestions(b, 2, { logs, todayISO: WED });
  assert.equal(s[0].name, 'Push + Pull');
  // Wednesday of the block's week two, three sessions left, five days left: it fits.
  assert.equal(T.weekOverbooked(b, logs, WED), false);
  // Saturday, three left, two days: it does not.
  assert.equal(T.weekOverbooked(b, logs, '2026-11-28'), true);
});

test('storage, sharing and the schedule all survive a merged week', () => {
  const b = ppl();
  const tpl = clone(T.templateOf(b));
  T.mergeSessions(b, [byName(b, 1, 'Push').id, byName(b, 1, 'Pull').id], {});
  // Week one merged: what gets shared or re-run is still the five-day programme.
  assert.deepEqual(clone(T.templateOf(b)), tpl);
  // Packing either packs or leaves it alone, and either way it comes back identical.
  assert.deepEqual(clone(T.unpackBlock(T.packBlock(clone(b)))), clone(b));
});

test('rescheduling a merged week moves the plan, not the one-off', () => {
  const b = ppl();
  const logs = weekTwoSoFar(b);
  const m = T.mergeSessions(b, [byName(b, 2, 'Push').id, byName(b, 2, 'Pull').id], { logs, todayISO: WED });
  const pushWas = byName(b, 3, 'Push').dayOfWeek, pullWas = byName(b, 3, 'Pull').dayOfWeek;
  // The schedule editor shows week two's four rows. Move Legs 2 to Sunday and the merge to Friday.
  const rows = T.scheduleOf(b, WED);
  assert.equal(rows.length, 4);
  const dows = rows.map(r => r.name === 'Legs 2' ? 6 : r.id === m.session.id ? 4 : r.dayOfWeek);
  T.reschedule(b, dows, WED);
  assert.equal(byName(b, 2, 'Legs 2').dayOfWeek, 6);
  assert.equal(byName(b, 3, 'Legs 2').dayOfWeek, 6, 'the plan moved');
  assert.equal(byName(b, 2, 'Push + Pull').dayOfWeek, 4);
  assert.equal(byName(b, 3, 'Push').dayOfWeek, pushWas, 'next week\'s Push stays put');
  assert.equal(byName(b, 3, 'Pull').dayOfWeek, pullWas, 'next week\'s Pull stays put');
  assert.equal(b.daysPerWeek, 5);
});

test('a block with no merges reschedules exactly as before', () => {
  const b = ppl();
  T.reschedule(b, [0, 1, 2, 4, 6], WED);
  for (let w = 2; w <= 4; w++) assert.deepEqual(wk(b, w).map(s => s.dayOfWeek), [0, 1, 2, 4, 6], 'week ' + w);
  assert.deepEqual(wk(b, 1).map(s => s.dayOfWeek), T.programmeBlock('pplh5', {}).sessions.filter(s => s.week === 1).map(s => s.dayOfWeek), 'week one is history');
});

// ---- the lever, on the Train tab ---------------------------------------------------------------

const { app, mount, accountWith } = require('./helpers/app.js');

function trainHome(block, startOffsetDays) {
  const A = app();
  const db = accountWith(block);
  if (startOffsetDays) {
    const d = new Date(A.Store.todayISO() + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - startOffsetDays);
    block.startISO = d.toISOString().slice(0, 10);
  }
  const toasts = [];
  const props = {
    db, update(fn) { fn(db); }, showToast(msg) { toasts.push(msg); }, isPremium: true, onUpgrade() {}, block,
    onOpen() {}, onResume() {}, onFreeform() {}, go() {},
  };
  return { A, db, toasts, ui: mount(A.TrainHome, props) };
}

test('Merge days: the footer opens a preview, and applying it changes this week only', () => {
  const A = app();
  const block = A.Training.programmeBlock('pplh5', {});
  const { db, toasts, ui } = trainHome(block);
  try {
    ui.click('Merge days');
    assert.ok(ui.has('One session instead of several'), ui.text.slice(0, 400));
    // The best pair is picked for you, and the preview names where it came from.
    assert.ok(ui.has('Push + Pull'), ui.text.slice(0, 600));
    assert.ok(ui.has('Sized like your Upper day'));
    ui.click('Merge for week 1');
    const b = db.training.blocks[0];
    const w1 = A.Training.weekSessions(b, 1).map(s => s.name);
    assert.deepEqual(w1.filter(n => n === 'Push + Pull'), ['Push + Pull']);
    assert.equal(w1.length, 4);
    assert.equal(A.Training.weekSessions(b, 2).length, 5, 'next week untouched');
    assert.match(toasts[0], /merged for this week/);
  } finally { ui.unmount(); }
});

test('an overbooked week is offered the merge without being asked', () => {
  const A = app();
  const block = A.Training.programmeBlock('pplh5', {});
  // Saturday of the block's first week with nothing logged: five sessions, two days.
  const { ui } = trainHome(block, 5);
  try {
    assert.ok(ui.has('Short on days?'), ui.text.slice(0, 600));
    ui.click('Show me');
    assert.ok(ui.has('Merge for week 1'));
  } finally { ui.unmount(); }
});

test('a merged session says it is a one-off, and can be split back', () => {
  const A = app();
  const block = A.Training.programmeBlock('pplh5', {});
  const w1 = A.Training.weekSessions(block, 1);
  block.startISO = A.Store.todayISO();
  A.Training.mergeSessions(block, [w1[2].id, w1[3].id], {});
  const { db, ui } = trainHome(block);
  try {
    assert.ok(ui.has('Push + Pull merged for this week. Next week is back to normal.'), ui.text.slice(0, 600));
    ui.click('Split back');
    assert.equal(A.Training.weekSessions(db.training.blocks[0], 1).length, 5);
  } finally { ui.unmount(); }
});
