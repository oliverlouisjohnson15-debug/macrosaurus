'use strict';
/* Training.blockTweak: applying a change somebody asked for in words.
 *
 * The model proposes operations and this applies them, so these tests are the guarantee that
 * everything the model is NOT allowed to decide is actually settled here: that a movement it invents
 * cannot reach a block, that a number it makes up is clamped like any other, that a week already
 * trained is out of reach, and that a change to a programme reaches every remaining week rather than
 * quietly undoing itself when the week turns over.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

function prog() { return T.programmeBlock('mac5', {}); }
function names(block, week, day) {
  const s = block.sessions.filter(x => x.week === week && x.name === day)[0];
  return T.sessionItems(s).map(e => (T.byId(e.exerciseId) || {}).name || e.exerciseId);
}

test('a swap reaches every week of the block, not just the one in front of you', () => {
  const b = prog();
  const r = T.blockTweak(b, [{ op: 'swap', from: 'Barbell Incline Press', to: 'Machine Chest Press' }], {});
  assert.equal(r.rejected.length, 0);
  assert.equal(r.applied.length, 1);
  for (let w = 1; w <= b.weeks; w++) {
    assert.ok(names(r.block, w, 'Upper 1').includes('Machine chest press'), `week ${w} did not move`);
    assert.ok(!names(r.block, w, 'Upper 1').includes('Incline barbell press'), `week ${w} kept the old one`);
  }
});

test('the block handed in is never mutated', () => {
  const b = prog();
  const before = JSON.stringify(b);
  T.blockTweak(b, [{ op: 'remove', exercise: 'Dead Hang' }, { op: 'sets', exercise: 'Pec Deck', sets: 5 }], {});
  assert.equal(JSON.stringify(b), before);
});

test('weeks already trained are out of reach', () => {
  const b = prog();
  const r = T.blockTweak(b, [{ op: 'swap', from: 'Pec Deck', to: 'Cable fly' }], { fromWeek: 3 });
  assert.ok(names(r.block, 1, 'Upper 1').includes('Pec deck'), 'week 1 was rewritten');
  assert.ok(names(r.block, 2, 'Upper 1').includes('Pec deck'), 'week 2 was rewritten');
  assert.ok(!names(r.block, 3, 'Upper 1').includes('Pec deck'), 'week 3 did not move');
  assert.ok(/weeks 3-4/.test(r.applied[0]), 'the receipt did not say how far it reached: ' + r.applied[0]);
});

test('a movement the library has not got is refused, never invented', () => {
  const b = prog();
  const r = T.blockTweak(b, [{ op: 'swap', from: 'Pec Deck', to: 'Reverse Gravitron Sky Press' }], {});
  assert.equal(r.applied.length, 0);
  assert.equal(r.rejected.length, 1);
  assert.ok(names(r.block, 1, 'Upper 1').includes('Pec deck'));
  // Nothing was minted into the library either.
  assert.ok(!T.all().some(e => /gravitron/i.test(e.name)));
});

test('a movement that is not in the block is reported rather than silently skipped', () => {
  const b = prog();
  const r = T.blockTweak(b, [{ op: 'sets', exercise: 'Barbell Bench Press', sets: 4 }], {});
  assert.equal(r.applied.length, 0);
  assert.equal(r.rejected.length, 1);
});

test('set counts move by their delta, so a block that ramps still ramps', () => {
  const b = T.generateBlock({ daysPerWeek: 3, weeks: 4 });
  const first = b.sessions.filter(s => s.week === 1)[0];
  const item = T.sessionItems(first)[0];
  const name = (T.byId(item.exerciseId) || {}).name;
  const setsByWeek = w => {
    const s = b.sessions.filter(x => x.week === w && x.name === first.name)[0];
    return T.sessionItems(s).filter(e => e.exerciseId === item.exerciseId)[0].target.sets;
  };
  const before = [1, 2, 3, 4].map(setsByWeek);
  const r = T.blockTweak(b, [{ op: 'sets', exercise: name, day: first.name, sets: before[0] + 1 }], {});
  const after = [1, 2, 3, 4].map(w => {
    const s = r.block.sessions.filter(x => x.week === w && x.name === first.name)[0];
    return T.sessionItems(s).filter(e => e.exerciseId === item.exerciseId)[0].target.sets;
  });
  for (let i = 0; i < 4; i++) assert.equal(after[i], Math.min(T.SETS_MAX, before[i] + 1), `week ${i + 1} did not keep its shape`);
});

test('numbers go through the same clamps a stepper tap does', () => {
  const b = prog();
  const r = T.blockTweak(b, [
    { op: 'sets', exercise: 'Pec Deck', sets: 99 },
    { op: 'reps', exercise: 'Leg Extension', repLow: 20, repHigh: 4 },
  ], {});
  // An impossible set count is refused outright rather than clamped into something nobody asked for.
  assert.ok(r.rejected.some(x => /set count/.test(x)));
  const s = r.block.sessions.filter(x => x.week === 1 && x.name === 'Lower 1')[0];
  const ext = T.sessionItems(s).filter(e => e.exerciseId === 'leg_extension')[0];
  assert.ok(ext.target.repLow <= ext.target.repHigh, 'a back-to-front rep range survived');
});

test('adding needs a day, and lands prescribed the way the block prescribes things', () => {
  const b = prog();
  const noDay = T.blockTweak(b, [{ op: 'add', exercise: 'Machine Lateral Raise' }], {});
  assert.equal(noDay.applied.length, 0);
  assert.equal(noDay.rejected.length, 1);

  const r = T.blockTweak(b, [{ op: 'add', day: 'Lower 1', exercise: 'Seated Leg Curl' }], {});
  assert.equal(r.applied.length, 1);
  for (let w = 1; w <= b.weeks; w++) assert.ok(names(r.block, w, 'Lower 1').includes('Seated leg curl'), `week ${w} missed it`);
  const s = r.block.sessions.filter(x => x.week === 1 && x.name === 'Lower 1')[0];
  const added = T.sessionItems(s).filter(e => e.exerciseId === 'seated_leg_curl')[0];
  // min-max: every set is an all-out set, so an added movement carries the same effort target as the
  // rest of the block rather than the volume model's ramp.
  assert.equal(added.target.rirLast, 0);
  assert.ok(added.target.sets >= T.SETS_MIN && added.target.sets <= T.SETS_MAX);
});

test('a day can be moved and renamed', () => {
  const b = prog();
  const r = T.blockTweak(b, [
    { op: 'day', day: 'Lower 2', dayOfWeek: 5 },
    { op: 'rename', day: 'Arms and delts', name: 'Arms' },
  ], {});
  assert.equal(r.rejected.length, 0);
  r.block.sessions.filter(s => s.name === 'Lower 2').forEach(s => assert.equal(s.dayOfWeek, 5));
  assert.ok(r.block.sessions.some(s => s.name === 'Arms'));
  assert.ok(!r.block.sessions.some(s => s.name === 'Arms and delts'));
});

test('an open slot can be answered by name', () => {
  const b = prog();
  const slot = T.blockChoices(b)[0];
  assert.ok(slot, 'the 5-day programme should ship with an open slot');
  const r = T.blockTweak(b, [{ op: 'choice', label: slot.label, exercise: 'Hack squat' }], {});
  assert.equal(r.applied.length, 1);
  assert.equal(T.blockChoices(r.block)[0].picked, 'hack_squat');
});

test('a day name that is not in the block is reported', () => {
  const b = prog();
  const r = T.blockTweak(b, [{ op: 'remove', day: 'Push', exercise: 'Pec Deck' }], {});
  assert.equal(r.applied.length, 0);
  assert.equal(r.rejected.length, 1);
});

test('a shortened day name still finds its session', () => {
  const b = prog();
  const r = T.blockTweak(b, [{ op: 'remove', day: 'Arms', exercise: 'Dead Hang' }], {});
  assert.equal(r.applied.length, 1);
  assert.ok(!names(r.block, 1, 'Arms and delts').includes('Dead hang'));
});

test('one instruction cannot rewrite the whole block', () => {
  const b = prog();
  const many = [];
  for (let i = 0; i < T.TWEAK_MAX_OPS + 1; i++) many.push({ op: 'remove', exercise: 'Pec Deck' });
  const r = T.blockTweak(b, many, {});
  assert.equal(r.applied.length, 0);
  assert.equal(JSON.stringify(r.block), JSON.stringify(b), 'nothing should have been applied');
});

test('operations it does not know are ignored, not guessed at', () => {
  const b = prog();
  const r = T.blockTweak(b, [{ op: 'deleteBlock' }, { op: 'addWeek', weeks: 8 }], {});
  assert.equal(r.applied.length, 0);
  assert.equal(r.ops, 0);
  assert.equal(JSON.stringify(r.block), JSON.stringify(b));
});
