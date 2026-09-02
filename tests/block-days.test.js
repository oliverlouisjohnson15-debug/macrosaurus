'use strict';
/* Changing how many days a week a block runs, after it has been built.
 *
 * The day count was the one answer the build wizard asked that nothing afterwards could change, so
 * "I can train five days now, not four" meant building the block again from nothing. These are the
 * guarantees that make changing it in place safe: that the days you already have survive it
 * untouched, that what arrives and what leaves is named, that a running block keeps every log
 * pointing at it, and that a week already trained is out of reach.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

const four = () => T.generateBlock({ daysPerWeek: 4, weeks: 4 });
const names = (block, week) => T.weekSessions(block, week).slice()
  .sort((a, b) => a.dayOfWeek - b.dayOfWeek).map(s => s.name);
const moves = (block, week, day) => {
  const s = T.weekSessions(block, week).filter(x => x.name === day)[0];
  return T.sessionItems(s).map(e => e.exerciseId + ':' + e.target.sets);
};

test('going up adds a day and leaves the ones you had alone', () => {
  const b = four();
  const was = names(b, 1);
  const kept = was.map(d => moves(b, 1, d));
  const r = T.setDaysPerWeek(b, 5, {});
  assert.equal(r.changed, true);
  assert.equal(r.days, 5);
  assert.equal(r.block.daysPerWeek, 5);
  assert.equal(r.added.length, 1, 'one day arrived: ' + r.added.join(', '));
  assert.deepEqual(r.removed, []);
  // Every day that was there is still there, with the same movements and the same sets on them.
  was.forEach((d, i) => assert.deepEqual(moves(r.block, 1, d), kept[i], d + ' was rewritten'));
  assert.deepEqual(names(r.block, 1).slice(0, 4), was);
  // And it is the whole block, not week one.
  for (let w = 1; w <= b.weeks; w++) assert.equal(T.weekSessions(r.block, w).length, 5, 'week ' + w);
});

test('the day it adds is the kind of day the week has least of', () => {
  // Four days of upper/lower going to six: the week is short of push, pull and legs days, not of a
  // fifth upper. Adding the split's trailing days would have handed it another lower.
  const r = T.setDaysPerWeek(four(), 6, {});
  const kinds = T.weekSessions(r.block, 1).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek).map(s => s.kind);
  assert.equal(kinds.filter(k => k === 'upper').length, 2, 'the upper days it had');
  assert.equal(kinds.filter(k => k === 'lower').length, 2, 'the lower days it had');
  assert.equal(kinds.length, 6);
  assert.ok(kinds.filter(k => ['push', 'pull', 'legs', 'full', 'arms'].indexOf(k) !== -1).length === 2,
    'the two that arrived are days it had not got: ' + kinds.join(', '));
});

test('no two days end up with the same name, or the same ids', () => {
  const r = T.setDaysPerWeek(four(), 6, {});
  const day = names(r.block, 1);
  assert.equal(new Set(day).size, day.length, 'duplicate day names: ' + day.join(', '));
  const sids = r.block.sessions.map(s => s.id);
  assert.equal(new Set(sids).size, sids.length, 'duplicate session ids');
  const iids = r.block.sessions.reduce((a, s) => a.concat(s.exercises.map(e => e.id)), []);
  assert.equal(new Set(iids).size, iids.length, 'duplicate line ids');
});

test('going down takes days off the end of the week and says which', () => {
  const b = four();
  const was = names(b, 1);
  const r = T.setDaysPerWeek(b, 3, {});
  assert.deepEqual(r.removed, [was[3]]);
  assert.deepEqual(names(r.block, 1), was.slice(0, 3));
  assert.equal(r.block.daysPerWeek, 3);
  for (let w = 1; w <= b.weeks; w++) assert.equal(T.weekSessions(r.block, w).length, 3, 'week ' + w);
});

test('the block is still the same block, so a log still points at it', () => {
  const b = four();
  const first = T.weekSessions(b, 1).slice().sort((x, y) => x.dayOfWeek - y.dayOfWeek)[0];
  const r = T.setDaysPerWeek(b, 5, {});
  assert.equal(r.block.id, b.id, 'a new block id would orphan every log');
  assert.ok(r.block.sessions.some(s => s.id === first.id), 'the session a log names is still there');
  assert.equal(r.block.name, b.name);
  assert.equal(r.block.weeks, b.weeks);
  assert.equal(r.block.shape, b.shape);
});

test('a week already trained is left exactly as it was', () => {
  const b = four();
  const before = JSON.parse(JSON.stringify(T.weekSessions(b, 1)));
  const r = T.setDaysPerWeek(b, 6, { fromWeek: 3 });
  assert.equal(T.weekSessions(r.block, 1).length, 4, 'week 1 was trained at four days');
  assert.equal(T.weekSessions(r.block, 2).length, 4, 'and so was week 2');
  assert.equal(T.weekSessions(r.block, 3).length, 6, 'the change starts at the week you are on');
  assert.equal(T.weekSessions(r.block, 4).length, 6);
  assert.deepEqual(T.weekSessions(r.block, 1), before, 'week 1 is a record, not a plan to edit');
});

test('min-max re-lays its week, because the rest days are the method', () => {
  const b = T.generateBlock({ style: 'minmax', shape: 'minmax4', weeks: 4, daysPerWeek: 4 });
  const r = T.setDaysPerWeek(b, 5, {});
  const dows = T.weekSessions(r.block, 1).map(s => s.dayOfWeek).sort((x, y) => x - y);
  assert.deepEqual(dows, T.recommendedDows(b, 5).slice().sort((x, y) => x - y));
});

test('a week we do not prescribe keeps the weekdays you gave it', () => {
  const b = four();
  T.weekSessions(b, 1).forEach(s => { /* the block as generated */ });
  // Move everything to the weekend end of the week, as somebody with an awkward shift pattern would.
  b.sessions.forEach(s => { s.dayOfWeek = (s.dayOfWeek + 2) % 7; });
  const was = {};
  T.weekSessions(b, 1).forEach(s => { was[s.name] = s.dayOfWeek; });
  const r = T.setDaysPerWeek(b, 5, {});
  T.weekSessions(r.block, 1).forEach(s => {
    if (was[s.name] != null) assert.equal(s.dayOfWeek, was[s.name], s.name + ' was moved');
  });
  const dows = T.weekSessions(r.block, 1).map(s => s.dayOfWeek);
  assert.equal(new Set(dows).size, dows.length, 'the new day landed on a free weekday');
});

test('it clamps to what the app can build, and does nothing when nothing changed', () => {
  const b = four();
  assert.equal(T.setDaysPerWeek(b, 4, {}).changed, false);
  assert.equal(T.setDaysPerWeek(b, 4, {}).block.daysPerWeek, 4);
  assert.equal(T.setDaysPerWeek(b, 9, {}).days, 6);
  assert.equal(T.setDaysPerWeek(b, 1, {}).days, 2);
  assert.equal(T.setDaysPerWeek(b, 'nonsense', {}).changed, false);
});

test('an imported plan can change its day count too', () => {
  const b = T.programmeBlock('mac5', {});
  const r = T.setDaysPerWeek(b, 3, {});
  assert.equal(r.days, 3);
  assert.equal(r.removed.length, 2);
  assert.equal(T.weekSessions(r.block, 1).length, 3);
  assert.equal(r.block.name, b.name, 'it is still their programme, at three days');
});

/* ---- the control itself -----------------------------------------------------------------------
 * The engine half is above. This is that the answer is reachable: on the screen somebody is looking
 * at when they realise their week has changed, doing what it says, and reversible.
 */
const { app, mount, accountWith } = require('./helpers/app.js');
const A = app();

function builder() {
  const block = A.Training.generateBlock({ daysPerWeek: 4, weeks: 4 });
  block.startISO = null;
  const db = accountWith(block);
  db.training.blocks = [block];
  return mount(A.BlockBuilder, {
    db, update() {}, showToast() {}, isPremium: true, onUpgrade() {},
    blockId: block.id, onBack() {}, onStart() {}, onSchedule() {},
  });
}
// The day count buttons are a bare "5" among a screen full of numbers, so they are found by the
// control they sit in rather than by their words.
function pressDays(ui, n) {
  const card = Array.from(ui.host.querySelectorAll('div'))
    .filter(d => d.textContent.indexOf('Days a week') !== -1 && d.querySelectorAll('button').length >= 5)
    .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  assert.ok(card, 'the days control is on the screen: ' + ui.text.slice(0, 400));
  const el = Array.from(card.querySelectorAll('button')).filter(b => b.textContent.trim() === String(n))[0];
  assert.ok(el, 'there is a "' + n + '" to press');
  ui.clickEl(el);
}

test('the day count can be changed from the block screen', () => {
  const ui = builder();
  try {
    assert.ok(ui.has('Days a week'), 'the control is there: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('4 sessions in week 1'), 'and says where it stands: ' + ui.text.slice(0, 400));
    pressDays(ui, 6);
    assert.ok(ui.has('6 sessions in week 1'), 'six days now: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Added '), 'and it names what arrived: ' + ui.text.slice(0, 600));
    ui.click('Put it back to 4 days');
    assert.ok(ui.has('4 sessions in week 1'), 'back where it was');
  } finally { ui.unmount(); }
});

test('dropping a day says which day went', () => {
  const ui = builder();
  try {
    pressDays(ui, 3);
    assert.ok(ui.has('3 sessions in week 1'), 'three days now: ' + ui.text.slice(0, 400));
    assert.ok(ui.has('Took out '), 'and it names what left: ' + ui.text.slice(0, 600));
  } finally { ui.unmount(); }
});
